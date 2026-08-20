require("dotenv").config();
const express = require("express");
const session = require("express-session");
const axios = require("axios");
const path = require("path");
const mongoose = require("mongoose");

const app = express();
const PORT = process.env.PORT || 3000;

app.set("trust proxy", 1);
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

async function refreshDiscordSession(req) {
  const u = req.session?.user;
  if (!u) return false;
  if (!u.refreshToken || !u.accessTokenExpiresAt || Date.now() < Number(u.accessTokenExpiresAt)) return true;
  try {
    const { data } = await axios.post(`${DISCORD_API}/oauth2/token`, new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID,
      client_secret: process.env.DISCORD_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: u.refreshToken,
    }), { headers: { "Content-Type": "application/x-www-form-urlencoded" } });
    u.accessToken = data.access_token;
    u.refreshToken = data.refresh_token || u.refreshToken;
    u.accessTokenExpiresAt = Date.now() + Math.max(60, Number(data.expires_in || 604800) - 60) * 1000;
    req.session.user = u;
    return true;
  } catch (e) {
    return false;
  }
}

async function requireAuth(req, res, next) {
  if (!(req.session && req.session.user)) return res.status(401).json({ error: "Not authenticated" });
  if (!(await refreshDiscordSession(req))) {
    return req.session.destroy(() => res.status(401).json({ error: "Session expired" }));
  }
  next();
}

const DISCORD_API = "https://discord.com/api/v10";
const BOT_OWNER_ID = process.env.BOT_OWNER_ID || "1414287578387189932";
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN || "";
const SCOPES = ["identify", "guilds"];
const PERM_MANAGE_GUILD = 0x20n;

function configStatus() {
  return {
    oauth: !!(process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET && process.env.DISCORD_REDIRECT_URI),
    botToken: !!BOT_TOKEN,
    mongo: !!process.env.MONGODB_URI,
    owner: BOT_OWNER_ID,
  };
}

function guildPermissionBits(perms) {
  try {
    return BigInt(perms);
  } catch {
    return 0n;
  }
}

function getAuthURL() {
  const params = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID,
    redirect_uri: process.env.DISCORD_REDIRECT_URI,
    response_type: "code",
    scope: SCOPES.join(" "),
    prompt: "consent",
  });
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

async function exchangeCode(code) {
  const { data } = await axios.post(
    `${DISCORD_API}/oauth2/token`,
    new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID,
      client_secret: process.env.DISCORD_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: process.env.DISCORD_REDIRECT_URI,
      scope: SCOPES.join(" "),
    }),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );
  return data;
}

async function fetchDiscordUser(token) {
  const { data } = await axios.get(`${DISCORD_API}/users/@me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return data;
}

async function fetchDiscordUserById(userId) {
  try {
    const { data } = await axios.get(`${DISCORD_API}/users/${userId}`, {
      headers: { Authorization: `Bot ${BOT_TOKEN}` },
    });
    return data;
  } catch {
    return null;
  }
}

async function fetchUserGuilds(token) {
  const { data } = await axios.get(`${DISCORD_API}/users/@me/guilds`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return data;
}

async function fetchBotGuildIds() {
  const guilds = await fetchBotGuilds();
  return new Set(guilds.map((g) => String(g.id)));
}

async function manageableGuilds(userGuilds) {
  const botIds = await fetchBotGuildIds();
  return (userGuilds || [])
    .filter((g) => (guildPermissionBits(g.permissions) & PERM_MANAGE_GUILD) === PERM_MANAGE_GUILD)
    .filter((g) => botIds.has(String(g.id)))
    .map((g) => ({
      id: String(g.id),
      name: g.name,
      icon: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=128&format=png` : `https://cdn.discordapp.com/embed/avatars/${Number(g.id.slice(-1)) % 5}.png`,
      owner: !!g.owner,
    }));
}

async function fetchBotGuilds() {
  try {
    const { data } = await axios.get(`${DISCORD_API}/users/@me/guilds`, {
      headers: { Authorization: `Bot ${BOT_TOKEN}` },
    });
    return data;
  } catch {
    return [];
  }
}

async function fetchGuildDetails(guildId) {
  try {
    const { data } = await axios.get(`${DISCORD_API}/guilds/${guildId}`, {
      headers: { Authorization: `Bot ${BOT_TOKEN}` },
      params: { with_counts: true },
    });
    return data;
  } catch {
    return null;
  }
}

async function fetchGuildResources(guildId) {
  try {
    const [channelsRes, rolesRes] = await Promise.all([
      axios.get(`${DISCORD_API}/guilds/${guildId}/channels`, { headers: { Authorization: `Bot ${BOT_TOKEN}` } }),
      axios.get(`${DISCORD_API}/guilds/${guildId}/roles`, { headers: { Authorization: `Bot ${BOT_TOKEN}` } }),
    ]);
    let members = [];
    try {
      const mr = await axios.get(`${DISCORD_API}/guilds/${guildId}/members`, { headers: { Authorization: `Bot ${BOT_TOKEN}` }, params: { limit: 1000 } });
      members = (mr.data || []).map(m => ({ id: m.user?.id, name: m.user?.global_name || m.user?.username || m.user?.id, username: m.user?.username || '', bot: !!m.user?.bot }));
    } catch {}
    return {
      channels: (channelsRes.data || []).map(c => ({ id: c.id, name: c.name, type: c.type, parentId: c.parent_id || null })),
      roles: (rolesRes.data || []).map(r => ({ id: r.id, name: r.name, position: r.position, color: r.color, managed: !!r.managed })),
      members,
    };
  } catch (e) {
    return { channels: [], roles: [] };
  }
}

/* ---------- MongoDB ---------- */
let dbConnected = false;
let dbError = null;

const MONGO_URI = process.env.MONGODB_URI;

const { Schema } = mongoose;

// Persistent session store for Vercel/serverless. express-session's default
// MemoryStore loses sessions when the function instance changes, so sessions
// are stored in the same MongoDB used by Revo.
class MongoSessionStore extends session.Store {
  constructor() {
    super();
    this.collectionName = "revo_dashboard_sessions";
  }
  collection() {
    if (mongoose.connection.readyState !== 1) return null;
    return mongoose.connection.collection(this.collectionName);
  }
  async ensureIndexes() {
    const c = this.collection();
    if (!c) return;
    try { await c.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }); } catch {}
  }
  get(sid, cb) {
    const c = this.collection();
    if (!c) return cb(null, null);
    c.findOne({ _id: sid }).then(doc => {
      if (!doc || (doc.expiresAt && new Date(doc.expiresAt) <= new Date())) return cb(null, null);
      cb(null, doc.session || null);
    }).catch(err => cb(err));
  }
  set(sid, sess, cb) {
    const c = this.collection();
    if (!c) return cb?.(new Error("MongoDB unavailable"));
    const maxAge = Number(sess?.cookie?.maxAge) || 7 * 24 * 60 * 60 * 1000;
    c.updateOne({ _id: sid }, { $set: { session: sess, expiresAt: new Date(Date.now() + maxAge) } }, { upsert: true })
      .then(() => { this.ensureIndexes().catch(() => {}); cb?.(); }).catch(err => cb?.(err));
  }
  touch(sid, sess, cb) { this.set(sid, sess, cb); }
  destroy(sid, cb) {
    const c = this.collection();
    if (!c) return cb?.();
    c.deleteOne({ _id: sid }).then(() => cb?.()).catch(err => cb?.(err));
  }
}

const sessionStore = new MongoSessionStore();

app.use(
  session({
    secret: process.env.SESSION_SECRET || "revo-secret",
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: { maxAge: 30 * 24 * 60 * 60 * 1000, httpOnly: true, secure: true, sameSite: "lax" },
  })
);

const accountSchema = new Schema(
  {
    guildId: String, userId: String, balance: Number,
    blacklisted: Boolean, hiddenTop: Boolean, isOwner: Boolean,
    isAdmin: Boolean, isVip: Boolean,
    nextVipRewardAt: Date, nextDailyRewardAt: Date,
    transferCooldownUntil: Date,
  },
  { timestamps: true }
);
const transferSchema = new Schema(
  {
    guildId: String, kind: String,
    fromUserId: String, toUserId: String,
    amount: Number, tax: Number, totalDebited: Number,
    reason: String,
  },
  { timestamps: true }
);
const feedbackSchema = new Schema(
  { guildId: String, userId: String, messageId: String, content: String, status: String, analysis: String, rewardedAt: Date },
  { timestamps: true }
);
const shortcutSchema = new Schema({ trigger: String, command: String, roleIds: [String], deleteUserMessage: Boolean, deleteBotResponse: Boolean, deleteDelay: Number, cooldownMs: Number }, { _id: false });
const autoResponseSchema = new Schema({ responseId: String, trigger: String, response: String, responseType: String, roleIds: [String], channelIds: [String], enabled: Boolean, matchMode: String, deleteUserMessage: Boolean, deleteBotResponse: Boolean, deleteDelay: Number, cooldownMs: Number }, { _id: false });
const systemConfigSchema = new Schema(
  { guildId: String, shortcuts: [shortcutSchema], autoResponses: [autoResponseSchema], logsChannelId: String, systemSettings: Schema.Types.Mixed },
  { timestamps: true }
);
const slashCommandConfigSchema = new Schema(
  { guildId: String, enabledCommands: [String], registeredCommands: [String], comeSlashEnabled: Boolean, comePrefixEnabled: Boolean },
  { timestamps: true }
);
const welcomeImageSchema = new Schema({ backgroundUrl: String, avatarPosition: { x: Number, y: Number }, avatarSize: Number, avatarShape: String }, { _id: false });
const welcomeConfigSchema = new Schema(
  { guildId: String, enabled: Boolean, welcomeChannel: String, welcomeDM: Boolean, welcomeMessage: String, autoRole: String, botAutoRole: String, welcomeImage: welcomeImageSchema, welcomeType: String },
  { timestamps: true }
);
const protectionConfigSchema = new Schema(
  { guildId: String, protection: Schema.Types.Mixed, logsEnabled: Boolean },
  { timestamps: true }
);
const levelBoostRoleSchema = new Schema({ roleId: String, percent: Number }, { _id: false });
const levelRewardSchema = new Schema({ level: Number, roleId: String }, { _id: false });
const levelConfigSchema = new Schema(
  { guildId: String, enabled: Boolean, maxLevel: Number, maxXp: Number, xpPerMessage: Number, cooldownMs: Number, multiplier: Number, levelUpChannelId: String, levelUpMode: String, ignoreEmpty: Boolean, ignoreRepeated: Boolean, repeatWindowMs: Number, repeatThreshold: Number, ignoreBots: Boolean, xpChannelIds: [String], ignoredChannelIds: [String], ignoredRoleIds: [String], boostRoles: [levelBoostRoleSchema], levelRewards: [levelRewardSchema], roleReplacement: Boolean, registeredCommands: [String] },
  { timestamps: true }
);
const levelMemberSchema = new Schema({ guildId: String, userId: String, xp: Number, level: Number }, { timestamps: true });
const premiumSubscriptionSchema = new Schema({ guildId: String, ownerId: String, startDate: Date, expireDate: Date, startAt: Date, expiresAt: Date, durationMs: Number, status: String, cancelledAt: Date, createdBy: String }, { timestamps: true });
const premiumIdentitySchema = new Schema({ guildId: String, baseAvatarUrl: String, baseBannerUrl: String, baseNickname: String, premiumAvatarCustomized: Boolean, premiumAvatarUrl: String, premiumBannerCustomized: Boolean, premiumBannerUrl: String, premiumNicknameCustomized: Boolean, premiumNickname: String }, { timestamps: true });
const ticketQuestionSchema = new Schema({ label: String, placeholder: String, required: Boolean, maxLength: Number }, { _id: false });
const ticketRolePermissionSchema = new Schema({ roleId: String, permissions: { view: Boolean, send: Boolean, claim: Boolean, close: Boolean, reopen: Boolean, delete: Boolean, add: Boolean, remove: Boolean, transcript: Boolean } }, { _id: false });
const ticketPanelSchema = new Schema(
  { guildId: String, name: String, description: String, emoji: String, image: String, thumbnail: String, color: Number, messageStyle: String, categoryId: String, supportRoleIds: [String], mentionRoleIds: [String], ticketNameFormat: String, openingMethod: String, form: [ticketQuestionSchema], autoMessages: Schema.Types.Mixed, rolePermissions: [ticketRolePermissionSchema], enabled: Boolean, isQuick: Boolean, claimEnabled: Boolean, claimPoints: Number, topClaimEnabled: Boolean, topPointEnabled: Boolean, transcriptEnabled: Boolean, logChannelId: String, ticketPrefix: String, enabledCommands: [String], panelMessageId: String, panelChannelId: String },
  { timestamps: true }
);
const ticketSchema = new Schema({ guildId: String, panelId: Schema.Types.ObjectId, channelId: String, creatorId: String, claimedBy: String, status: String, number: Number, answers: Map, blacklistedUserIds: [String], closedAt: Date, closedBy: String, controlMessageId: String }, { timestamps: true });
const publisherShopSchema = new Schema({ guildId: String, enabled: Boolean, categories: [String], channels: [String], rewardAmount: Number, cooldownMs: Number, mentionMode: String, statistics: Schema.Types.Mixed }, { timestamps: true });
const warningSchema = new Schema({ guildId: String, userId: String, moderatorId: String, reason: String }, { timestamps: true });
const profileBackgroundSchema = new Schema({ guildId: String, userId: String, imageUrl: String, contentType: String }, { timestamps: true });
const afkSchema = new Schema({ guildId: String, userId: String, reason: String, startedAt: Date, mentions: Schema.Types.Mixed }, { timestamps: true });
const reminderSchema = new Schema({ guildId: String, userId: String, channelId: String, text: String, remindAt: Date, deliveredAt: Date }, { timestamps: true });
const botVoiceStateSchema = new Schema({ guildId: String, voiceChannelId: String, autoReconnect: Boolean }, { timestamps: true });
const functionConfigSchema = new Schema({ guildId: String, enabled: Schema.Types.Mixed, allowedRoles: Schema.Types.Mixed, leaveRoleId: String, blacklistRoleId: String, roleCategories: [Schema.Types.Mixed] }, { timestamps: true });
const premiumRoomSchema = new Schema({ guildId: String, emoji: [String], emojiSources: [String], sticker: [String], stickerSources: [String], outline: { channels: [String], image: String }, autorec: { channels: [String], emoji: String } }, { timestamps: true });
const logConfigSchema = new Schema({ guildId: String, globalChannelId: String, events: Schema.Types.Mixed }, { timestamps: true });
const Warning = mongoose.models.RevoWarning || mongoose.model("RevoWarning", warningSchema);
const ProfileBackground = mongoose.models.RevoProfileBackground || mongoose.model("RevoProfileBackground", profileBackgroundSchema);
const Afk = mongoose.models.RevoAfk || mongoose.model("RevoAfk", afkSchema);
const Reminder = mongoose.models.RevoReminder || mongoose.model("RevoReminder", reminderSchema);
const BotVoiceState = mongoose.models.RevoBotVoiceState || mongoose.model("RevoBotVoiceState", botVoiceStateSchema);
const Feedback = mongoose.models.RevoFeedback || mongoose.model("RevoFeedback", feedbackSchema);

const Account = mongoose.models.RevoAccount || mongoose.model("RevoAccount", accountSchema);
const Transfer = mongoose.models.RevoTransfer || mongoose.model("RevoTransfer", transferSchema);
const SystemConfig = mongoose.models.RevoSystemConfig || mongoose.model("RevoSystemConfig", systemConfigSchema);
const SlashCommandConfig = mongoose.models.RevoSlashCommandConfig || mongoose.model("RevoSlashCommandConfig", slashCommandConfigSchema);
const WelcomeConfig = mongoose.models.RevoWelcomeConfig || mongoose.model("RevoWelcomeConfig", welcomeConfigSchema);
const ProtectionConfig = mongoose.models.RevoProtectionConfig || mongoose.model("RevoProtectionConfig", protectionConfigSchema);
const LevelConfig = mongoose.models.RevoLevelConfig || mongoose.model("RevoLevelConfig", levelConfigSchema);
const LevelMember = mongoose.models.RevoLevelMember || mongoose.model("RevoLevelMember", levelMemberSchema);
const PremiumSubscription = mongoose.models.RevoPremiumSubscription || mongoose.model("RevoPremiumSubscription", premiumSubscriptionSchema);
const PremiumIdentity = mongoose.models.RevoPremiumIdentity || mongoose.model("RevoPremiumIdentity", premiumIdentitySchema);
const TicketPanel = mongoose.models.RevoTicketPanel || mongoose.model("RevoTicketPanel", ticketPanelSchema);
const Ticket = mongoose.models.RevoTicket || mongoose.model("RevoTicket", ticketSchema);
const PublisherShop = mongoose.models.RevoPublisherShop || mongoose.model("RevoPublisherShop", publisherShopSchema);
const FunctionConfig = mongoose.models.RevoFunctionConfig || mongoose.model("RevoFunctionConfig", functionConfigSchema);
const LogConfig = mongoose.models.RevoLogConfig || mongoose.model("RevoLogConfig", logConfigSchema);
const PremiumRoomConfig = mongoose.models.RevoPremiumRoomConfig || mongoose.model("RevoPremiumRoomConfig", premiumRoomSchema);

function connectDB() {
  if (!MONGO_URI) {
    dbError = "MONGODB_URI not configured";
    console.log("[REVO] Mongo URI missing, using demo data");
    return;
  }
  mongoose
    .connect(MONGO_URI, { serverSelectionTimeoutMS: 8000 })
    .then(() => {
      dbConnected = true;
      dbError = null;
      console.log("[REVO] MongoDB connected");
    })
    .catch((err) => {
      dbConnected = false;
      dbError = err.message;
      console.log("[REVO] MongoDB connection failed:", err.message);
      setTimeout(connectDB, 15000);
    });
}
connectDB();

async function db(fn, fallback) {
  if (!dbConnected) return { demo: true, ...fallback };
  try {
    return await fn();
  } catch (e) {
    console.log("[REVO] DB query error:", e.message);
    return { demo: true, ...fallback };
  }
}

/* ---------- Demo fallback data ---------- */
function demoAccount() {
  return { userId: "1539330787902754826", balance: 3131902375, isVip: true, isAdmin: false, isOwner: true, blacklisted: false, hiddenTop: false, level: 16, xp: 2450, maxXp: 5000, globalRank: 533960 };
}

const DAILY_REWARD = 5000;
const DAILY_PERIOD_MS = 24 * 60 * 60 * 1000;
const ACCOUNT_SCOPE = "global";

const PROTECTION_DEFAULTS = {
  antiSpam:{enabled:false,limit:5,windowMs:3000,punishment:"timeout",allowedRoleIds:[],ignoredRoleIds:[],ignoredChannelIds:[]},
  antiEveryone:{enabled:false,punishment:"timeout",allowedRoleIds:[],ignoredRoleIds:[],ignoredChannelIds:[]},
  antiChannelCreate:{enabled:false,limit:3,windowMs:10000,punishment:"ban",allowedRoleIds:[],ignoredRoleIds:[]},
  antiRoleCreate:{enabled:false,limit:3,windowMs:10000,punishment:"ban",allowedRoleIds:[],ignoredRoleIds:[]},
  antiChannelDelete:{enabled:false,limit:2,windowMs:10000,punishment:"ban",allowedRoleIds:[],ignoredRoleIds:[]},
  antiRoleDelete:{enabled:false,limit:2,windowMs:10000,punishment:"ban",allowedRoleIds:[],ignoredRoleIds:[]},
  antiLongMessage:{enabled:false,maxLength:2000,deleteMessage:true,punishment:"timeout",repeatThreshold:2,repeatWindowMs:30000,allowedRoleIds:[],ignoredRoleIds:[],ignoredChannelIds:[]},
  antiMassMention:{enabled:false,maxMentions:5,punishment:"timeout",allowedRoleIds:[],ignoredRoleIds:[],ignoredChannelIds:[]},
  protectedMembers:{enabled:false,protectedMemberIds:[],maxMentions:1,punishment:"timeout",allowedRoleIds:[],ignoredRoleIds:[],ignoredChannelIds:[]},
  antiChannelUpdate:{enabled:false,punishment:"ban",allowedRoleIds:[],ignoredRoleIds:[]},
  antiRoleUpdate:{enabled:false,punishment:"ban",allowedRoleIds:[],ignoredRoleIds:[]},
  antiBot:{enabled:false,punishment:"kick",whitelistIds:[],allowedRoleIds:[],ignoredRoleIds:[]},
  antiMassJoin:{enabled:false,limit:5,windowMs:10000,punishment:"kick",whitelistIds:[],allowedRoleIds:[],ignoredRoleIds:[]},
  antiWebhook:{enabled:false,punishment:"ban",whitelistIds:[],allowedRoleIds:[],ignoredRoleIds:[]},
  antiChannelSpam:{enabled:false,limit:3,windowMs:10000,punishment:"ban",whitelistIds:[],allowedRoleIds:[],ignoredRoleIds:[]},
  antiRoleSpam:{enabled:false,limit:3,windowMs:10000,punishment:"ban",whitelistIds:[],allowedRoleIds:[],ignoredRoleIds:[]},
  antiPermissionAbuse:{enabled:false,punishment:"ban",whitelistIds:[],allowedRoleIds:[],ignoredRoleIds:[]}
};
const PROTECTION_LABELS = {antiSpam:"Anti Spam",antiEveryone:"Anti Everyone / Here",antiChannelCreate:"Anti Channel Create",antiRoleCreate:"Anti Role Create",antiChannelDelete:"Anti Channel Delete",antiRoleDelete:"Anti Role Delete",antiLongMessage:"Anti Long Message",antiMassMention:"Anti Mass Mention",protectedMembers:"Protected Members",antiChannelUpdate:"Anti Channel Update",antiRoleUpdate:"Anti Role Update",antiBot:"Anti Bot",antiMassJoin:"Anti Mass Join",antiWebhook:"Anti Webhook",antiChannelSpam:"Anti Channel Spam",antiRoleSpam:"Anti Role Spam",antiPermissionAbuse:"Anti Permission Abuse"};
function mergedProtection(value={}) { return Object.fromEntries(Object.entries(PROTECTION_DEFAULTS).map(([k,d])=>[k,{...d,...(value?.[k]||{})}])); }

function demoLeaderboard() {
  return [
    { rank: 1, userId: "5rx", tag: "5rx", initials: "5R", balance: 3130000000 },
    { rank: 2, userId: "yousef", tag: "Yousef#0001", initials: "Yo", balance: 2550000000 },
    { rank: 3, userId: "ahmed", tag: "Ahmed#1234", initials: "Ah", balance: 1980000000 },
    { rank: 4, userId: "m7md", tag: "M7MD#9999", initials: "M7", balance: 1250000000 },
    { rank: 5, userId: "zoro", tag: "Zoro", initials: "Zo", balance: 980000000 },
    { rank: 6, userId: "salah", tag: "Salah#7777", initials: "Sa", balance: 875000000 },
    { rank: 7, userId: "kira", tag: "KIRA", initials: "KI", balance: 760000000 },
    { rank: 8, userId: "fares", tag: "Fares", initials: "Fa", balance: 650000000 },
    { rank: 9, userId: "hamo", tag: "Hamo", initials: "Ha", balance: 540000000 },
    { rank: 10, userId: "mostafa", tag: "Mostafa", initials: "Mo", balance: 420000000 },
  ];
}

function demoTransfers() {
  const now = Date.now();
  return [
    { from: "Yousef#0001", fromInitials: "Yo", amount: 150000, type: "incoming", timeAgo: "منذ ٣ دقائق" },
    { from: "Ahmed#1234", fromInitials: "Ah", amount: -75000, type: "outgoing", timeAgo: "منذ ١٠ دقائق" },
    { from: "Salah#7777", fromInitials: "Sa", amount: 250000, type: "incoming", timeAgo: "منذ ٢٥ دقيقة" },
    { from: "M7MD#9999", fromInitials: "M7", amount: -100000, type: "outgoing", timeAgo: "منذ ساعة" },
    { from: "Revo System", fromInitials: "Re", amount: 5000, type: "incoming", timeAgo: "منذ ساعة" },
  ];
}

function demoGuildStats() {
  return {
    name: "Revo Community",
    id: "1300854796940742696",
    memberCount: 12458,
    online: true,
    stats: {
      messages: { value: "2.45M", change: 12.5 },
      newMembers: { value: "18,549", change: 8.2 },
      activeMembers: { value: "1,245", change: 15.3 },
      transfers: { value: "3,785", change: 10.1 },
    },
  };
}

/* ---------- OAuth ---------- */
app.get("/auth/login", (req, res) => res.redirect(getAuthURL()));
app.get("/auth/add-bot", (req, res) => {
  const params = new URLSearchParams({ client_id: process.env.DISCORD_CLIENT_ID || "", permissions: process.env.BOT_INVITE_PERMISSIONS || "8", scope: "bot applications.commands" });
  res.redirect(`https://discord.com/oauth2/authorize?${params.toString()}`);
});

function requireGuild(req, res, next) {
  const guildId = req.query.guildId || req.session.selectedGuildId;
  if (!guildId) return res.status(400).json({ error: "No guild selected" });
  req.guildId = String(guildId);
  next();
}

app.get("/auth/callback", async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect("/");
  try {
    const tokenData = await exchangeCode(code);
    const user = await fetchDiscordUser(tokenData.access_token);
    const guilds = await fetchUserGuilds(tokenData.access_token);
    req.session.user = {
      id: user.id,
      username: user.username,
      discriminator: user.discriminator || "0",
      globalName: user.global_name || user.username,
      avatar: user.avatar
        ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`
        : `https://cdn.discordapp.com/embed/avatars/${parseInt(user.discriminator || "0") % 5}.png`,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token || null,
      accessTokenExpiresAt: Date.now() + Math.max(60, Number(tokenData.expires_in || 604800) - 60) * 1000,
      guilds,
    };
    req.session.save(() => res.redirect("/dashboard.html"));
  } catch (error) {
    console.error("OAuth callback error:", error.response?.data || error.message);
    res.redirect("/?error=auth_failed");
  }
});

app.get("/auth/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/"));
});

app.get("/api/guilds", requireAuth, async (req, res) => {
  const guilds = await manageableGuilds(req.session.user.guilds);
  res.json({ guilds, selectedGuildId: req.session.selectedGuildId || null });
});

app.post("/api/guild/select", requireAuth, async (req, res) => {
  const { guildId } = req.body || {};
  const guilds = await manageableGuilds(req.session.user.guilds);
  const allowed = guilds.some((g) => g.id === String(guildId));
  if (!allowed) return res.status(403).json({ error: "Not allowed" });
  req.session.selectedGuildId = String(guildId);
  res.json({ ok: true, guildId: String(guildId) });
});

app.get("/api/user", requireAuth, async (req, res) => {
  const u = req.session.user;
  const guildId = req.query.guildId || req.session.selectedGuildId || null;
  let account = null;
  let rank = null;
  let level = null;
  let maxXp = 3000;
  if (dbConnected) {
    try {
      account = await Account.findOne({ guildId: ACCOUNT_SCOPE, userId: u.id }).lean();
      if (account) {
        const better = await Account.countDocuments({ balance: { $gt: account.balance || 0 } });
        rank = better + 1;
      }
      if (guildId) {
        const member = await LevelMember.findOne({ guildId, userId: u.id }).lean();
        const lvlCfg = await LevelConfig.findOne({ guildId }).lean();
        if (member) level = { level: member.level || 1, xp: member.xp || 0 };
        if (lvlCfg && lvlCfg.maxXp) maxXp = lvlCfg.maxXp;
      }
    } catch (e) {
      console.log("[REVO] user query error:", e.message);
    }
  }
  res.json({
    id: u.id,
    username: u.username,
    globalName: u.globalName,
    avatar: u.avatar,
    guilds: u.guilds || [],
    selectedGuildId: req.session.selectedGuildId || null,
    daily: { reward: DAILY_REWARD, periodMs: DAILY_PERIOD_MS },
    account: account
      ? {
          userId: u.id,
          balance: account.balance || 0,
          isVip: !!account.isVip,
          isAdmin: !!account.isAdmin,
          isOwner: !!account.isOwner || u.id === BOT_OWNER_ID,
          blacklisted: !!account.blacklisted,
          hiddenTop: !!account.hiddenTop,
          nextDailyRewardAt: account.nextDailyRewardAt || null,
          nextVipRewardAt: account.nextVipRewardAt || null,
          level: level?.level ?? 1,
          xp: level?.xp ?? 0,
          maxXp,
          globalRank: rank,
        }
      : null,
    demo: !dbConnected,
  });
});

app.get("/api/leaderboard", requireAuth, async (req, res) => {
  const data = await db(
    async () => {
      const top = await Account.find({ guildId: ACCOUNT_SCOPE, hiddenTop: { $ne: true } }).sort({ balance: -1 }).limit(10).lean();
      return top.map((a, i) => ({
        rank: i + 1,
        userId: a.userId,
        tag: a.userId,
        initials: String(a.userId).slice(0, 2).toUpperCase(),
        balance: a.balance || 0,
      }));
    },
    []
  );
  res.json(data);
});

app.get("/api/transfers", requireAuth, async (req, res) => {
  const u = req.session.user;
  const data = await db(
    async () => {
      const recs = await Transfer.find({ $or: [{ fromUserId: u.id }, { toUserId: u.id }] }).sort({ createdAt: -1 }).limit(10).lean();
      return recs.map((r) => {
        const incoming = String(r.toUserId) === u.id;
        return {
          id: String(r._id),
          from: r.fromUserId || "Revo System",
          fromInitials: String(r.fromUserId || "Revo").slice(0, 2).toUpperCase(),
          amount: incoming ? r.amount : -(r.totalDebited ?? r.amount ?? 0),
          type: incoming ? "incoming" : "outgoing",
          timeAgo: timeAgo(r.createdAt),
          kind: r.kind || "transfer",
        };
      });
    },
    []
  );
  res.json(data);
});

app.get("/api/guild/stats", requireAuth, requireGuild, async (req, res) => {
  const guildId = req.guildId;
  const data = await db(
    async () => {
      const [accounts, transfers, levelMembers] = await Promise.all([
        Account.countDocuments({ guildId }).catch(() => 0),
        Transfer.countDocuments({ guildId }).catch(() => 0),
        LevelMember.countDocuments({ guildId }).catch(() => 0),
      ]);
      const welcome = await WelcomeConfig.findOne({ guildId }).lean().catch(() => null);
      const protection = await ProtectionConfig.findOne({ guildId }).lean().catch(() => null);
      const level = await LevelConfig.findOne({ guildId }).lean().catch(() => null);
      const tickets = await TicketPanel.countDocuments({ guildId, enabled: true }).catch(() => 0);
      const g = await fetchGuildDetails(guildId);
      return {
        name: g?.name || "Revo Community",
        id: guildId,
        memberCount: g?.approximate_member_count || members,
        online: true,
        stats: {
          messages: { value: '—', change: null },
          newMembers: { value: fmtNum(accounts), change: null },
          activeMembers: { value: fmtNum(levelMembers), change: null },
          transfers: { value: fmtNum(transfers), change: null },
        },
        systems: {
          welcome: !!welcome?.enabled,
          tickets: tickets > 0,
          level: !!level?.enabled,
          protection: !!(protection?.protection && Object.keys(protection.protection).length > 0),
          autoResponse: false,
          roomSystems: false,
        },
      };
    },
    demoGuildStats()
  );
  res.json(data);
});

app.get("/api/guild/shortcuts", requireAuth, requireGuild, async (req, res) => {
  const guildId = req.guildId;
  const data = await db(
    async () => {
      const cfg = await SystemConfig.findOne({ guildId }).lean().catch(() => null);
      return (cfg?.shortcuts || []).map((s) => ({ trigger: s.trigger, command: s.command }));
    },
    [
      { trigger: "زيارة السيرفر", command: "Server Invite" },
      { trigger: "تسجيل أمر", command: "Register Command" },
      { trigger: "إعطاء عضو", command: "Give Member" },
      { trigger: "إنشاء تذكرة", command: "Create Ticket" },
      { trigger: "إرسال إعلان", command: "Send Announcement" },
    ]
  );
  res.json(data);
});

app.get("/api/guild/welcome", requireAuth, requireGuild, async (req, res) => {
  const guildId = req.guildId;
  const data = await db(
    async () => {
      const cfg = await WelcomeConfig.findOne({ guildId }).lean().catch(() => null);
      return cfg || { guildId, enabled: false, welcomeChannel: null, welcomeDM: false, welcomeMessage: "", autoRole: null, botAutoRole: null, welcomeType: "message" };
    },
    { guildId, enabled: true, welcomeChannel: "1325344190242881576", welcomeDM: false, welcomeMessage: "أهلًا [user] في **[displayName]**!", autoRole: null, botAutoRole: null, welcomeType: "message" }
  );
  res.json(data);
});

app.get("/api/guild/protection", requireAuth, requireGuild, async (req, res) => {
  const guildId = req.guildId;
  const data = await db(
    async () => {
      const cfg = await ProtectionConfig.findOne({ guildId }).lean().catch(() => null);
      return cfg ? { ...cfg, protection: mergedProtection(cfg.protection) } : { guildId, protection: mergedProtection(), logsEnabled: true };
    },
    { guildId, protection: {}, logsEnabled: true }
  );
  res.json(data);
});

app.get("/api/guild/level", requireAuth, requireGuild, async (req, res) => {
  const guildId = req.guildId;
  const data = await db(
    async () => {
      const cfg = await LevelConfig.findOne({ guildId }).lean().catch(() => null);
      const memberCount = await LevelMember.countDocuments({ guildId }).catch(() => 0);
      const top = await LevelMember.find({ guildId }).sort({ xp: -1 }).limit(10).lean().catch(() => []);
      return {
        config: cfg || { guildId, enabled: true, maxLevel: 100, maxXp: 3000, xpPerMessage: 10, cooldownMs: 10000, multiplier: 1, levelUpMode: "same" },
        memberCount,
        top: top.map((m, i) => ({ rank: i + 1, userId: m.userId, xp: m.xp, level: m.level })),
      };
    },
    { config: { guildId, enabled: true, maxLevel: 100, maxXp: 3000, xpPerMessage: 10, cooldownMs: 10000, multiplier: 1, levelUpMode: "same" }, memberCount: 12458, top: [] }
  );
  res.json(data);
});

app.get("/api/guild/tickets", requireAuth, requireGuild, async (req, res) => {
  const guildId = req.guildId;
  const data = await db(
    async () => {
      const panels = await TicketPanel.find({ guildId }).lean().catch(() => []);
      const open = await Ticket.countDocuments({ guildId, status: "open" }).catch(() => 0);
      return { panels, openTickets: open };
    },
    { panels: [], openTickets: 0 }
  );
  res.json(data);
});

app.get("/api/guild/autoresponse", requireAuth, requireGuild, async (req, res) => {
  const guildId = req.guildId;
  const data = await db(
    async () => {
      const cfg = await SystemConfig.findOne({ guildId }).lean().catch(() => null);
      return { autoResponses: cfg?.autoResponses || [] };
    },
    { autoResponses: [] }
  );
  res.json(data);
});

/* ---------- Full bot catalog + advanced configuration ---------- */
const BOT_COMMAND_CATALOG = [
  ["help","أساسي","مركز المساعدة"],["top","اقتصاد","لوحة المتصدرين"],["daily","اقتصاد","المكافأة اليومية"],["transfer","اقتصاد","تحويل رصيد"],["revo","اقتصاد","أدوات Revo"],["feedback","اقتصاد","إرسال Feedback"],
  ["setup-system","الإدارة","لوحة الإدارة"],["ban","الإدارة","حظر عضو"],["unban","الإدارة","فك الحظر"],["kick","الإدارة","طرد عضو"],["timeout","الإدارة","Timeout"],["untimeout","الإدارة","إلغاء Timeout"],["warn","الإدارة","تحذير"],["warnings","الإدارة","عرض التحذيرات"],["unwarn","الإدارة","حذف تحذير"],["clear","الإدارة","مسح الرسائل"],["role-add","الإدارة","إضافة رتبة"],["role-remove","الإدارة","إزالة رتبة"],["nickname","الإدارة","تغيير الاسم"],["lock","الإدارة","قفل القناة"],["unlock","الإدارة","فتح القناة"],["slowmode","الإدارة","Slowmode"],["unslowmode","الإدارة","إلغاء Slowmode"],
  ["voice-kick","الصوت","طرد صوتي"],["voice-move","الصوت","نقل صوتي"],["voice-mute","الصوت","Mute"],["voice-unmute","الصوت","Unmute"],["deafen","الصوت","Deafen"],["undeafen","الصوت","Undeafen"],
  ["setup-welcome","الترحيب","إعداد الترحيب"],["setup-response","الردود","إعداد الردود التلقائية"],["setup-ticket","التذاكر","إعداد التذاكر"],["setup-level","XP","إعداد XP"],["level","XP","عرض مستوى"],["leaderboard","XP","المتصدرين"],["xp-add","XP","إضافة XP"],["xp-remove","XP","إزالة XP"],["xp-reset","XP","تصفير XP"],["xp-set","XP","تحديد XP"],["level-set","XP","تحديد Level"],["level-remove","XP","إزالة Level"],["leaderboard-reset","XP","تصفير الترتيب"],
  ["setup-protection","الحماية","17 نظام حماية"],["setup-function","الوظائف","إدارة الوظائف"],["set-role","الوظائف","ربط Role بالوظيفة"],["setup-shop","الناشرين","متجر الناشرين"],["room","Premium","إدارة Premium Rooms"],["bot","Premium","تخصيص البوت"],["premium","Premium","إدارة الاشتراك"],
  ["come","Utility","استدعاء عضو"],["register-command","Utility","تسجيل أمر"],["embed","Utility","إرسال Embed"],["container","Utility","إرسال Container"],["sticker","Utility","إرسال Sticker"],["emoji","Utility","إرسال Emoji"],["avatar","Utility","Avatar"],["banner","Utility","Banner"],["server-avatar","Utility","صورة السيرفر"],["server-banner","Utility","Banner السيرفر"],["user-info","Utility","معلومات عضو"],["server-info","Utility","معلومات السيرفر"],["role-info","Utility","معلومات رتبة"],["channel-info","Utility","معلومات قناة"],["emoji-info","Utility","معلومات Emoji"],["invite-info","Utility","معلومات Invite"],["poll","Utility","تصويت"],["say","Utility","إرسال رسالة"],["announce","Utility","Announcement"],["translate","Utility","ترجمة"],["remind","Utility","Reminder"],["afk","Utility","AFK"],["calculator","Utility","حاسبة"],["color","Utility","معلومات لون"],["timestamp","Utility","Timestamp"],["member-count","Utility","عدد الأعضاء"],["server-avatar","Utility","صورة السيرفر"],["server-banner","Utility","بانر السيرفر"]
].map(([name,category,description])=>({name,category,description}));
const BOT_SYSTEM_CATALOG = [
 {id:"economy",name:"الاقتصاد والحسابات",icon:"💰",items:["daily","transfer","top","revo","feedback"]},
 {id:"moderation",name:"الإدارة والعقوبات",icon:"🛡️",items:["setup-system","ban","unban","kick","timeout","untimeout","warn","warnings","unwarn","clear","role-add","role-remove","nickname","lock","unlock","slowmode","unslowmode"]},
 {id:"protection",name:"الحماية المتقدمة",icon:"🧿",items:["setup-protection"]},
 {id:"welcome",name:"الترحيب والصور",icon:"👋",items:["setup-welcome"]},
 {id:"autoresponse",name:"الردود التلقائية",icon:"💬",items:["setup-response"]},
 {id:"tickets",name:"التذاكر والدعم",icon:"🎫",items:["setup-ticket"]},
 {id:"levels",name:"XP & Levels",icon:"📈",items:["setup-level","level","leaderboard","xp-add","xp-remove","xp-reset","xp-set","level-set","level-remove","leaderboard-reset"]},
 {id:"functions",name:"الوظائف والرتب",icon:"⚙️",items:["setup-function","set-role"]},
 {id:"logs",name:"السجلات",icon:"📜",items:["logs"]},
 {id:"slash",name:"Slash & Commands",icon:"⌘",items:["register-command"]},
 {id:"publisher",name:"متجر الناشرين",icon:"🛍️",items:["setup-shop"]},
 {id:"rooms",name:"Premium Rooms",icon:"🛰️",items:["room"]},
 {id:"premium",name:"Premium & Bot Identity",icon:"💎",items:["premium","bot"]},
 {id:"voice",name:"أنظمة الصوت",icon:"🔊",items:["voice-kick","voice-move","voice-mute","voice-unmute","deafen","undeafen"]},
 {id:"utility",name:"الأدوات والـUtility",icon:"🧰",items:["come","embed","container","sticker","emoji","avatar","banner","poll","say","announce","translate","remind","afk","calculator","color","timestamp","member-count","server-info","user-info","role-info","channel-info","emoji-info","invite-info"]}
];
const BOT_COMMAND_DETAILS = [
  ["admin help","Administration","لوحة المساعدة الإدارية"],
  ["setup-system","Administration","إعداد الإدارة والاختصارات والسجلات"],
  ["ban","Moderation","حظر عضو"],["unban","Moderation","فك الحظر"],["kick","Moderation","طرد عضو"],["timeout","Moderation","Timeout"],["untimeout","Moderation","إلغاء Timeout"],["warn","Moderation","تحذير"],["warnings","Moderation","عرض التحذيرات"],["unwarn","Moderation","حذف تحذير"],["clear","Moderation","مسح الرسائل"],["role-add","Moderation","إضافة رتبة"],["role-remove","Moderation","إزالة رتبة"],["nickname","Moderation","تغيير الاسم"],["lock","Moderation","قفل القناة"],["unlock","Moderation","فتح القناة"],["slowmode","Moderation","تفعيل Slowmode"],["unslowmode","Moderation","إلغاء Slowmode"],
  ["voice-kick","Voice","طرد عضو من الصوت"],["voice-move","Voice","نقل عضو صوتيًا"],["voice-mute","Voice","Server Mute"],["voice-unmute","Voice","إلغاء Server Mute"],["deafen","Voice","Server Deafen"],["undeafen","Voice","إلغاء Deafen"],
  ["setup-welcome","Welcome","إعداد الترحيب"],["setup-response","Auto Response","إدارة الردود التلقائية"],["setup-ticket","Tickets","إعداد التذاكر"],["ticket-create","Tickets","إنشاء تذكرة"],["ticket-delete","Tickets","حذف تذكرة"],["ticket-add","Tickets","إضافة عضو للتذكرة"],["ticket-remove","Tickets","إزالة عضو من التذكرة"],["ticket-blacklist","Tickets","حظر عضو من التذاكر"],["ticket-unblacklist","Tickets","إلغاء حظر عضو من التذاكر"],["ticket-blacklist-list","Tickets","قائمة حظر التذاكر"],["ticket-claim","Tickets","استلام التذكرة"],["ticket-unclaim","Tickets","إلغاء استلام التذكرة"],["ticket-topclaim","Tickets","Top Claim"],["ticket-toppoint","Tickets","Top Point"],["ticket-close","Tickets","إغلاق التذكرة"],["ticket-reopen","Tickets","إعادة فتح التذكرة"],["ticket-transcript","Tickets","Transcript"],["setup-level","XP","إعداد XP"],["level","XP","عرض مستوى العضو"],["leaderboard","XP","لوحة المتصدرين"],["xp-add","XP","إضافة XP"],["xp-remove","XP","إزالة XP"],["xp-reset","XP","تصفير XP"],["xp-set","XP","تحديد XP"],["level-set","XP","تحديد Level"],["level-remove","XP","إزالة Level"],["leaderboard-reset","XP","تصفير المتصدرين"],
  ["setup-protection","Protection","إدارة أنظمة الحماية"],["setup-function","Functions","إدارة الوظائف والرتب"],["set-role","Functions","ربط رتبة بالوظيفة"],["setup-shop","Publisher Shop","إعداد متجر الناشرين"],["room","Premium Rooms","إدارة غرف Premium"],["bot avatar","Bot Customization","تخصيص Avatar"],["bot banner","Bot Customization","تخصيص Banner"],["bot nickname","Bot Customization","تخصيص Nickname"],["premium","Premium","إدارة اشتراكات Premium"],
  ["come","Utility","استدعاء عضو"],["register-command","Utility","تسجيل الأوامر"],["embed","Utility","إرسال Embed"],["container","Utility","إرسال Container"],["sticker","Utility","إرسال Sticker"],["emoji","Utility","إرسال Emoji"],["avatar","Utility","صورة عضو"],["banner","Utility","Banner عضو"],["server-avatar","Utility","صورة السيرفر"],["server-banner","Utility","Banner السيرفر"],["user-info","Utility","معلومات عضو"],["server-info","Utility","معلومات السيرفر"],["role-info","Utility","معلومات رتبة"],["channel-info","Utility","معلومات قناة"],["emoji-info","Utility","معلومات Emoji"],["invite-info","Utility","معلومات Invite"],["poll","Utility","تصويت"],["say","Utility","إرسال رسالة"],["announce","Utility","إعلان"],["translate","Utility","ترجمة"],["remind","Utility","تذكير"],["afk","Utility","AFK"],["calculator","Utility","حاسبة"],["color","Utility","معلومات لون"],["timestamp","Utility","Timestamp"],["member-count","Utility","عدد الأعضاء"],
  ["help","Economy","المساعدة العامة"],["top","Economy","المتصدرين الاقتصاديين"],["daily","Economy","المكافأة اليومية"],["transfer","Economy","تحويل الرصيد"],["revo","Economy","أدوات Revo"],["feedback","Economy","Feedback والمكافآت"]
].map(([name,category,description])=>({name,category,description}));

app.get("/api/bot/catalog", requireAuth, (req,res) => res.json({commands: BOT_COMMAND_DETAILS, systems: BOT_SYSTEM_CATALOG}));
app.get("/api/guild/resources", requireAuth, requireGuild, async (req,res) => res.json(await fetchGuildResources(req.guildId)));

app.get("/api/guild/full-config", requireAuth, requireGuild, async (req,res) => {
  const guildId=req.guildId;
  const data=await db(async()=>{
    const [system,slash,func,logs,publisher,rooms,premium,tickets,welcome,protection,level]=await Promise.all([
      SystemConfig.findOne({guildId}).lean(), SlashCommandConfig.findOne({guildId}).lean(), FunctionConfig.findOne({guildId}).lean(), LogConfig.findOne({guildId}).lean(), PublisherShop.findOne({guildId}).lean(), PremiumRoomConfig.findOne({guildId}).lean(), PremiumIdentity.findOne({guildId}).lean(), PremiumSubscription.findOne({guildId}).lean(), TicketPanel.find({guildId}).lean(), WelcomeConfig.findOne({guildId}).lean(), ProtectionConfig.findOne({guildId}).lean(), LevelConfig.findOne({guildId}).lean()
    ]);
    return {system,slash,functionConfig:func,logs,publisher,rooms,premium,premiumSubscription,tickets,welcome,protection,level,botConfig:{prefix:process.env.REVO_PREFIX || "?",revoPrefix:"Re",standardTaxRate:0.05,vipTaxRate:0.05,feedbackReward:12000,vipReward:25000,vipPeriodMs:432000000,dailyReward:5000,dailyPeriodMs:86400000,vipRoleId:process.env.REVO_VIP_ROLE_ID || "1453524820737392732",premiumRoleId:process.env.REVO_PREMIUM_ROLE_ID || "1453524816631038208",blacklistRoleId:process.env.REVO_BLACKLIST_ROLE_ID || "1538169306674888784",aiModel:process.env.AI_MODEL || "llama-3.3-70b-versatile",aiConfigured:!!process.env.AI_API_KEY}};
  }, {system:null,slash:null,functionConfig:null,logs:null,publisher:null,rooms:null,premium:null,tickets:[]});
  res.json(data);
});

app.get("/api/guild/advanced", requireAuth, requireGuild, async (req,res)=>{
  const guildId=req.guildId;
  const data=await db(async()=>{
    const [warnings,feedback,profiles,afk,reminders,voice,system,slash,premiumIdentity]=await Promise.all([
      Warning.countDocuments({guildId}), Feedback.countDocuments({guildId}), ProfileBackground.countDocuments({guildId}), Afk.countDocuments({guildId}), Reminder.countDocuments({guildId,deliveredAt:null}), BotVoiceState.findOne({guildId}).lean(), SystemConfig.findOne({guildId}).lean(), SlashCommandConfig.findOne({guildId}).lean(), PremiumIdentity.findOne({guildId}).lean()
    ]);
    return {warnings,feedback,profiles,afk,reminders,voice,system,slash,premiumIdentity};
  },{warnings:0,feedback:0,profiles:0,afk:0,reminders:0,voice:null,system:null,slash:null,premiumIdentity:null});
  res.json(data);
});


app.get("/api/guild/economy", requireAuth, requireGuild, async (req,res)=>{
  const guildId=req.guildId; const userId=req.session.user.id;
  const data=await db(async()=>{
    const [account, transfers, feedback, top, stats] = await Promise.all([
      Account.findOne({guildId:ACCOUNT_SCOPE,userId}).lean(),
      Transfer.find({guildId}).sort({createdAt:-1}).limit(25).lean(),
      Feedback.find({guildId}).sort({createdAt:-1}).limit(25).lean(),
      Account.find({guildId:ACCOUNT_SCOPE,hiddenTop:{$ne:true}}).sort({balance:-1}).limit(20).lean(),
      Transfer.aggregate([{ $match:{guildId} },{ $group:{ _id:null, count:{ $sum:1 }, volume:{ $sum:"$amount" } } }])
    ]);
    return {account, transfers, feedback, top, stats:stats[0]||{count:0,volume:0}, daily:{reward:DAILY_REWARD,periodMs:DAILY_PERIOD_MS}};
  },{account:null,transfers:[],feedback:[],top:[],stats:{count:0,volume:0},daily:{reward:DAILY_REWARD,periodMs:DAILY_PERIOD_MS}});
  res.json(data);
});

app.get("/api/guild/moderation", requireAuth, requireGuild, async (req,res)=>{
  const guildId=req.guildId; const data=await db(async()=>{
    const [warnings, shortcuts, logs] = await Promise.all([Warning.find({guildId}).sort({createdAt:-1}).limit(50).lean(), SystemConfig.findOne({guildId}).lean(), LogConfig.findOne({guildId}).lean()]);
    return {warnings,shortcuts:shortcuts?.shortcuts||[],logs:logs||null};
  },{warnings:[],shortcuts:[],logs:null}); res.json(data);
});

app.get("/api/guild/utility", requireAuth, requireGuild, async (req,res)=>{
  const guildId=req.guildId; const data=await db(async()=>{
    const [afk,reminders,profiles,voice,feedback] = await Promise.all([Afk.find({guildId}).sort({createdAt:-1}).limit(50).lean(),Reminder.find({guildId,deliveredAt:null}).sort({remindAt:1}).limit(50).lean(),ProfileBackground.find({guildId}).sort({createdAt:-1}).limit(50).lean(),BotVoiceState.findOne({guildId}).lean(),Feedback.find({guildId}).sort({createdAt:-1}).limit(50).lean()]);
    return {afk,reminders,profiles,voice,feedback};
  },{afk:[],reminders:[],profiles:[],voice:null,feedback:[]}); res.json(data);
});

app.get("/api/guild/premium", requireAuth, requireGuild, async (req,res)=>{
  const guildId=req.guildId; const data=await db(async()=>{
    const [subscription,identity,rooms,publisher] = await Promise.all([PremiumSubscription.findOne({guildId}).lean(),PremiumIdentity.findOne({guildId}).lean(),PremiumRoomConfig.findOne({guildId}).lean(),PublisherShop.findOne({guildId}).lean()]);
    return {subscription,identity,rooms,publisher};
  },{subscription:null,identity:null,rooms:null,publisher:null}); res.json(data);
});

app.post("/api/guild/function", requireAuth, requireGuild, async(req,res)=>{ if(!dbConnected)return res.status(503).json({error:"Database unavailable"}); try{const body=req.body||{}; const cfg=await FunctionConfig.findOneAndUpdate({guildId:req.guildId},{ $set:{enabled:body.enabled||{},allowedRoles:body.allowedRoles||{},leaveRoleId:body.leaveRoleId||null,blacklistRoleId:body.blacklistRoleId||null,roleCategories:Array.isArray(body.roleCategories)?body.roleCategories:[]}},{new:true,upsert:true}).lean();res.json({ok:true,config:cfg});}catch(e){res.status(500).json({error:e.message})}});
app.post("/api/guild/slash", requireAuth, requireGuild, async(req,res)=>{ if(!dbConnected)return res.status(503).json({error:"Database unavailable"}); try{const body=req.body||{};const cfg=await SlashCommandConfig.findOneAndUpdate({guildId:req.guildId},{ $set:{enabledCommands:Array.isArray(body.enabledCommands)?body.enabledCommands:[],registeredCommands:Array.isArray(body.registeredCommands)?body.registeredCommands:[],comeSlashEnabled:!!body.comeSlashEnabled,comePrefixEnabled:!!body.comePrefixEnabled}},{new:true,upsert:true}).lean();res.json({ok:true,config:cfg});}catch(e){res.status(500).json({error:e.message})}});
app.post("/api/guild/logs", requireAuth, requireGuild, async(req,res)=>{ if(!dbConnected)return res.status(503).json({error:"Database unavailable"}); try{const body=req.body||{};const cfg=await LogConfig.findOneAndUpdate({guildId:req.guildId},{ $set:{globalChannelId:body.globalChannelId||null,events:body.events||{}}},{new:true,upsert:true}).lean();res.json({ok:true,config:cfg});}catch(e){res.status(500).json({error:e.message})}});
app.post("/api/guild/publisher", requireAuth, requireGuild, async(req,res)=>{ if(!dbConnected)return res.status(503).json({error:"Database unavailable"}); try{const b=req.body||{};const cfg=await PublisherShop.findOneAndUpdate({guildId:req.guildId},{ $set:{enabled:!!b.enabled,categories:Array.isArray(b.categories)?b.categories:[],channels:Array.isArray(b.channels)?b.channels:[],rewardAmount:Number(b.rewardAmount)||25000,cooldownMs:Number(b.cooldownMs)||90000000,mentionMode:b.mentionMode||"everyone"}},{new:true,upsert:true}).lean();res.json({ok:true,config:cfg});}catch(e){res.status(500).json({error:e.message})}});
app.post("/api/guild/rooms", requireAuth, requireGuild, async(req,res)=>{ if(!dbConnected)return res.status(503).json({error:"Database unavailable"}); try{const b=req.body||{};const cfg=await PremiumRoomConfig.findOneAndUpdate({guildId:req.guildId},{ $set:{emoji:Array.isArray(b.emoji)?b.emoji:[],emojiSources:Array.isArray(b.emojiSources)?b.emojiSources:[],sticker:Array.isArray(b.sticker)?b.sticker:[],stickerSources:Array.isArray(b.stickerSources)?b.stickerSources:[],outline:b.outline||{channels:[],image:null},autorec:b.autorec||{channels:[],emoji:null}}},{new:true,upsert:true}).lean();res.json({ok:true,config:cfg});}catch(e){res.status(500).json({error:e.message})}});
app.post("/api/guild/tickets/panel", requireAuth, requireGuild, async(req,res)=>{ if(!dbConnected)return res.status(503).json({error:"Database unavailable"}); try{const b=req.body||{}; if(!b.name)return res.status(400).json({error:"اسم اللوحة مطلوب"}); const cfg=await TicketPanel.findOneAndUpdate({guildId:req.guildId,name:b.name},{ $set:{description:b.description||"",emoji:b.emoji||"🎫",image:b.image||null,thumbnail:b.thumbnail||null,color:Number(b.color)||5793266,messageStyle:b.messageStyle||"embed",categoryId:b.categoryId||null,supportRoleIds:Array.isArray(b.supportRoleIds)?b.supportRoleIds:[],mentionRoleIds:Array.isArray(b.mentionRoleIds)?b.mentionRoleIds:[],ticketNameFormat:b.ticketNameFormat||"ticket-{number}",openingMethod:b.openingMethod||"button",form:Array.isArray(b.form)?b.form:[],autoMessages:b.autoMessages||{},rolePermissions:Array.isArray(b.rolePermissions)?b.rolePermissions:[],enabled:b.enabled!==false,isQuick:!!b.isQuick,claimEnabled:b.claimEnabled!==false,claimPoints:Number(b.claimPoints)||0,topClaimEnabled:!!b.topClaimEnabled,topPointEnabled:!!b.topPointEnabled,transcriptEnabled:b.transcriptEnabled!==false,logChannelId:b.logChannelId||null,ticketPrefix:b.ticketPrefix||"t!",enabledCommands:Array.isArray(b.enabledCommands)?b.enabledCommands:[]}},{new:true,upsert:true}).lean();res.json({ok:true,panel:cfg});}catch(e){res.status(500).json({error:e.message})}});

/* ---------- Controls (POST) ---------- */
app.post("/api/guild/welcome", requireAuth, requireGuild, async (req, res) => {
  const guildId = req.guildId;
  const body = req.body || {};
  if (!dbConnected) return res.status(503).json({ error: "Database unavailable" });
  try {
    const cfg = await WelcomeConfig.findOneAndUpdate(
      { guildId },
      {
        $set: {
          enabled: !!body.enabled,
          welcomeChannel: body.welcomeChannel || null,
          welcomeDM: !!body.welcomeDM,
          welcomeMessage: body.welcomeMessage || "",
          autoRole: body.autoRole || null,
          botAutoRole: body.botAutoRole || null,
          welcomeType: body.welcomeType || "message",
          welcomeImage: body.welcomeImage || { backgroundUrl: null, avatarPosition: { x: 50, y: 50 }, avatarSize: 128, avatarShape: "circle" },
        },
      },
      { new: true, upsert: true }
    ).lean();
    res.json({ ok: true, config: cfg });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/guild/protection", requireAuth, requireGuild, async (req, res) => {
  const guildId = req.guildId;
  const body = req.body || {};
  if (!dbConnected) return res.status(503).json({ error: "Database unavailable" });
  try {
    const cfg = await ProtectionConfig.findOneAndUpdate(
      { guildId },
      { $set: { protection: mergedProtection(body.protection), logsEnabled: body.logsEnabled !== false } },
      { new: true, upsert: true }
    ).lean();
    res.json({ ok: true, config: cfg });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/guild/level", requireAuth, requireGuild, async (req, res) => {
  const guildId = req.guildId;
  const body = req.body || {};
  if (!dbConnected) return res.status(503).json({ error: "Database unavailable" });
  try {
    const set = {
      enabled: !!body.enabled,
      maxLevel: Number(body.maxLevel) || 100,
      maxXp: Number(body.maxXp) || 3000,
      xpPerMessage: Number(body.xpPerMessage) || 10,
      cooldownMs: Number(body.cooldownMs) || 10000,
      multiplier: Number(body.multiplier) || 1,
      levelUpMode: body.levelUpMode || "same",
      levelUpChannelId: body.levelUpChannelId || null,
      xpChannelIds: Array.isArray(body.xpChannelIds) ? body.xpChannelIds : [],
      ignoredChannelIds: Array.isArray(body.ignoredChannelIds) ? body.ignoredChannelIds : [],
      ignoredRoleIds: Array.isArray(body.ignoredRoleIds) ? body.ignoredRoleIds : [],
      ignoreEmpty: body.ignoreEmpty !== false, ignoreRepeated: body.ignoreRepeated !== false, repeatWindowMs: Number(body.repeatWindowMs)||30000, repeatThreshold:Number(body.repeatThreshold)||3, ignoreBots: body.ignoreBots !== false,
      boostRoles: Array.isArray(body.boostRoles) ? body.boostRoles : [], levelRewards: Array.isArray(body.levelRewards) ? body.levelRewards : [], roleReplacement: !!body.roleReplacement, registeredCommands: Array.isArray(body.registeredCommands) ? body.registeredCommands : [],
    };
    const cfg = await LevelConfig.findOneAndUpdate({ guildId }, { $set: set }, { new: true, upsert: true }).lean();
    res.json({ ok: true, config: cfg });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/guild/autoresponse", requireAuth, requireGuild, async (req, res) => {
  const guildId = req.guildId;
  const body = req.body || {};
  if (!dbConnected) return res.status(503).json({ error: "Database unavailable" });
  try {
    const action = body.action || "add";
    const cfg = await SystemConfig.findOne({ guildId }).lean().catch(() => null) || { guildId, autoResponses: [] };
    let list = cfg.autoResponses || [];
    if (action === "add") {
      list = [...list, {
        responseId: require("crypto").randomUUID(),
        trigger: body.trigger || "",
        response: body.response || "",
        responseType: body.responseType || "message",
        enabled: body.enabled !== false,
        matchMode: body.matchMode || "exact",
        deleteUserMessage: !!body.deleteUserMessage,
        deleteBotResponse: !!body.deleteBotResponse,
        deleteDelay: Number(body.deleteDelay) || 3000,
        cooldownMs: Number(body.cooldownMs) || 3000,
        roleIds: Array.isArray(body.roleIds) ? body.roleIds : [],
        channelIds: Array.isArray(body.channelIds) ? body.channelIds : [],
      }];
    } else if (action === "remove") {
      list = list.filter((r) => r.responseId !== body.responseId);
    } else if (action === "update") {
      list = list.map((r) => r.responseId === body.responseId ? { ...r, trigger: body.trigger ?? r.trigger, response: body.response ?? r.response, responseType: body.responseType ?? r.responseType, matchMode: body.matchMode ?? r.matchMode, roleIds: Array.isArray(body.roleIds) ? body.roleIds : (r.roleIds||[]), channelIds: Array.isArray(body.channelIds) ? body.channelIds : (r.channelIds||[]), deleteUserMessage: !!body.deleteUserMessage, deleteBotResponse: !!body.deleteBotResponse, deleteDelay: Number(body.deleteDelay) || 3000, cooldownMs: Number(body.cooldownMs) || 3000 } : r);
    } else if (action === "toggle") {
      list = list.map((r) => r.responseId === body.responseId ? { ...r, enabled: body.enabled } : r);
    }
    const updated = await SystemConfig.findOneAndUpdate({ guildId }, { $set: { autoResponses: list } }, { new: true, upsert: true }).lean();
    res.json({ ok: true, autoResponses: updated.autoResponses || [] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


app.post("/api/guild/system", requireAuth, requireGuild, async (req,res)=>{ if(!dbConnected)return res.status(503).json({error:"Database unavailable"}); try{const b=req.body||{}; const cfg=await SystemConfig.findOneAndUpdate({guildId:req.guildId},{ $set:{shortcuts:Array.isArray(b.shortcuts)?b.shortcuts:[],logsChannelId:b.logsChannelId||null,systemSettings:b.systemSettings||{}}},{new:true,upsert:true}).lean();res.json({ok:true,config:cfg});}catch(e){res.status(500).json({error:e.message})}});
app.post("/api/guild/premium/identity", requireAuth, requireGuild, async(req,res)=>{ if(!dbConnected)return res.status(503).json({error:"Database unavailable"}); try{const b=req.body||{}; const cfg=await PremiumIdentity.findOneAndUpdate({guildId:req.guildId},{ $set:{premiumAvatarCustomized:!!b.premiumAvatarCustomized,premiumAvatarUrl:b.premiumAvatarUrl||null,premiumBannerCustomized:!!b.premiumBannerCustomized,premiumBannerUrl:b.premiumBannerUrl||null,premiumNicknameCustomized:!!b.premiumNicknameCustomized,premiumNickname:b.premiumNickname||null}},{new:true,upsert:true}).lean();res.json({ok:true,config:cfg});}catch(e){res.status(500).json({error:e.message})}});
app.post("/api/guild/tickets/panel/delete", requireAuth, requireGuild, async(req,res)=>{ if(!dbConnected)return res.status(503).json({error:"Database unavailable"}); try{await TicketPanel.deleteOne({_id:req.body?.id,guildId:req.guildId});res.json({ok:true});}catch(e){res.status(500).json({error:e.message})}});
app.post("/api/daily/claim", requireAuth, async (req, res) => {
  const u = req.session.user;
  const guildId = req.query.guildId || req.session.selectedGuildId || "global";
  if (!dbConnected) return res.status(503).json({ error: "Database unavailable" });
  try {
    const now = new Date();
    const nextClaimAt = new Date(now.getTime() + DAILY_PERIOD_MS);
    let existing = await Account.findOne({ guildId: ACCOUNT_SCOPE, userId: u.id });
    if (!existing) {
      existing = await Account.create({ guildId: ACCOUNT_SCOPE, userId: u.id, balance: 0, blacklisted: false, nextDailyRewardAt: null });
    }
    const claimedAccount = await Account.findOneAndUpdate(
      {
        guildId: ACCOUNT_SCOPE,
        userId: u.id,
        blacklisted: { $ne: true },
        $or: [{ nextDailyRewardAt: null }, { nextDailyRewardAt: { $lte: now } }],
      },
      { $inc: { balance: DAILY_REWARD }, $set: { nextDailyRewardAt: nextClaimAt } },
      { new: true }
    );
    if (claimedAccount) {
      await Transfer.create({
        guildId,
        kind: "daily-reward",
        toUserId: u.id,
        amount: DAILY_REWARD,
        tax: 0,
        totalDebited: 0,
        reason: "Daily reward",
      }).catch(() => {});
      return res.json({
        claimed: true,
        amount: DAILY_REWARD,
        nextClaimAt: claimedAccount.nextDailyRewardAt,
        balance: claimedAccount.balance,
      });
    }
    const account = await Account.findOne({ guildId: ACCOUNT_SCOPE, userId: u.id }).lean();
    return res.json({
      claimed: false,
      amount: DAILY_REWARD,
      nextClaimAt: account?.nextDailyRewardAt || null,
      balance: account?.balance || 0,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/bot/info", requireAuth, async (req, res) => {
  const [botUser, owner] = await Promise.all([
    fetchBotUser(),
    fetchDiscordUserById(BOT_OWNER_ID),
  ]);
  const guilds = await fetchBotGuilds();
  res.json({
    online: !!botUser,
    bot: botUser ? {
      id: botUser.id,
      username: botUser.username,
      globalName: botUser.global_name || botUser.username,
      avatar: botUser.avatar
        ? `https://cdn.discordapp.com/avatars/${botUser.id}/${botUser.avatar}.png?size=128`
        : null,
    } : null,
    owner: {
      id: BOT_OWNER_ID,
      mention: `<@${BOT_OWNER_ID}>`,
      username: owner?.username || null,
      globalName: owner?.global_name || owner?.username || null,
      avatar: owner?.avatar
        ? `https://cdn.discordapp.com/avatars/${BOT_OWNER_ID}/${owner.avatar}.png?size=128`
        : null,
    },
    guildCount: guilds.length,
    database: dbConnected,
  });
});

async function fetchBotUser() {
  try {
    const { data } = await axios.get(`${DISCORD_API}/users/@me`, {
      headers: { Authorization: `Bot ${BOT_TOKEN}` },
    });
    return data;
  } catch {
    return null;
  }
}

app.get("/api/config/status", requireAuth, (req, res) => {
  res.json(configStatus());
});

app.get("/api/check", (req, res) => {
  res.json({
    ok: true,
    authenticated: !!req.session?.user,
    dbConnected,
    demo: false,
  });
});

function timeAgo(date) {
  const diff = Date.now() - new Date(date).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "الآن";
  if (m < 60) return `منذ ${m} دقيقة`;
  const h = Math.floor(m / 60);
  if (h < 24) return `منذ ${h} ساعة`;
  const d = Math.floor(h / 24);
  return `منذ ${d} يوم`;
}

function fmtNum(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(2).replace(/\.00$/, "") + "M";
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n);
}

app.get("/dashboard.html", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "dashboard.html"));
});

app.get("/", (req, res) => {
  // The public landing page is always accessible. Authentication starts only
  // when the visitor explicitly presses the Discord login button.
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("*", (req, res) => {
  if (req.path.startsWith("/api/") || req.path.startsWith("/auth/")) return;
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`[REVO Dashboard] Running on http://localhost:${PORT}`);
    console.log(`[REVO Dashboard] Login URL: ${getAuthURL()}`);
  });
}

module.exports = app;
