require("dotenv").config();
const express = require("express");
const session = require("express-session");
const axios = require("axios");
const path = require("path");
const mongoose = require("mongoose");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "revo-secret",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 },
  })
);

function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  res.status(401).json({ error: "Not authenticated" });
}

const DISCORD_API = "https://discord.com/api/v10";
const SCOPES = ["identify", "guilds"];
const PERM_MANAGE_GUILD = 0x20n;

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
      icon: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=128` : null,
      owner: !!g.owner,
    }));
}

async function fetchBotGuilds() {
  try {
    const { data } = await axios.get(`${DISCORD_API}/users/@me/guilds`, {
      headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` },
    });
    return data;
  } catch {
    return [];
  }
}

async function fetchGuildDetails(guildId) {
  try {
    const { data } = await axios.get(`${DISCORD_API}/guilds/${guildId}`, {
      headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` },
      params: { with_counts: true },
    });
    return data;
  } catch {
    return null;
  }
}

/* ---------- MongoDB ---------- */
let dbConnected = false;
let dbError = null;

const MONGO_URI = process.env.MONGODB_URI;

const { Schema } = mongoose;

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
const functionConfigSchema = new Schema({ guildId: String, enabled: Schema.Types.Mixed, allowedRoles: Schema.Types.Mixed, leaveRoleId: String, blacklistRoleId: String, roleCategories: [Schema.Types.Mixed] }, { timestamps: true });
const logConfigSchema = new Schema({ guildId: String, globalChannelId: String, events: Schema.Types.Mixed }, { timestamps: true });

const Account = mongoose.models.RevoAccount || mongoose.model("RevoAccount", accountSchema, "Revoaccounts");
const Transfer = mongoose.models.RevoTransfer || mongoose.model("RevoTransfer", transferSchema, "Revtransfers");
const Feedback = mongoose.models.RevoFeedback || mongoose.model("RevoFeedback", feedbackSchema, "RevoFeedbacks");
const SystemConfig = mongoose.models.RevoSystemConfig || mongoose.model("RevoSystemConfig", systemConfigSchema, "RevoSystemConfigs");
const SlashCommandConfig = mongoose.models.RevoSlashCommandConfig || mongoose.model("RevoSlashCommandConfig", slashCommandConfigSchema, "RevoSlashCommandConfigs");
const WelcomeConfig = mongoose.models.RevoWelcomeConfig || mongoose.model("RevoWelcomeConfig", welcomeConfigSchema, "RevoWelcomeConfigs");
const ProtectionConfig = mongoose.models.RevoProtectionConfig || mongoose.model("RevoProtectionConfig", protectionConfigSchema, "RevoProtectionConfigs");
const LevelConfig = mongoose.models.RevoLevelConfig || mongoose.model("RevoLevelConfig", levelConfigSchema, "RevoLevelConfigs");
const LevelMember = mongoose.models.RevoLevelMember || mongoose.model("RevoLevelMember", levelMemberSchema, "RevoLevelMembers");
const PremiumSubscription = mongoose.models.RevoPremiumSubscription || mongoose.model("RevoPremiumSubscription", premiumSubscriptionSchema, "RevoPremiumSubscriptions");
const PremiumIdentity = mongoose.models.RevoPremiumIdentity || mongoose.model("RevoPremiumIdentity", premiumIdentitySchema, "RevoPremiumIdentities");
const TicketPanel = mongoose.models.RevoTicketPanel || mongoose.model("RevoTicketPanel", ticketPanelSchema, "RevoTicketPanels");
const Ticket = mongoose.models.RevoTicket || mongoose.model("RevoTicket", ticketSchema, "RevoTickets");
const PublisherShop = mongoose.models.RevoPublisherShop || mongoose.model("RevoPublisherShop", publisherShopSchema, "RevoPublisherShops");
const FunctionConfig = mongoose.models.RevoFunctionConfig || mongoose.model("RevoFunctionConfig", functionConfigSchema, "RevoFunctionConfigs");
const LogConfig = mongoose.models.RevoLogConfig || mongoose.model("RevoLogConfig", logConfigSchema, "RevoLogConfigs");

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
      guilds,
    };
    res.redirect("/dashboard.html");
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
          isOwner: !!account.isOwner,
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
      const [members, accounts, transfers, levelMembers] = await Promise.all([
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
          messages: { value: fmtNum(transfers), change: 10.1 },
          newMembers: { value: fmtNum(accounts), change: 8.2 },
          activeMembers: { value: fmtNum(levelMembers), change: 15.3 },
          transfers: { value: fmtNum(transfers), change: 12.5 },
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
      return cfg || { guildId, protection: {}, logsEnabled: true };
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
      { $set: { protection: body.protection || {}, logsEnabled: body.logsEnabled !== false } },
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
      }];
    } else if (action === "remove") {
      list = list.filter((r) => r.responseId !== body.responseId);
    } else if (action === "toggle") {
      list = list.map((r) => r.responseId === body.responseId ? { ...r, enabled: body.enabled } : r);
    }
    const updated = await SystemConfig.findOneAndUpdate({ guildId }, { $set: { autoResponses: list } }, { new: true, upsert: true }).lean();
    res.json({ ok: true, autoResponses: updated.autoResponses || [] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/daily/claim", requireAuth, async (req, res) => {
  const u = req.session.user;
  const guildId = req.query.guildId || req.session.selectedGuildId || "global";
  if (!dbConnected) return res.status(503).json({ error: "Database unavailable" });
  try {
    const now = new Date();
    const nextClaimAt = new Date(now.getTime() + DAILY_PERIOD_MS);
    const claimedAccount = await Account.findOneAndUpdate(
      {
        guildId: ACCOUNT_SCOPE,
        userId: u.id,
        blacklisted: false,
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

app.get("/api/check", (req, res) => {
  res.json({ ok: true, dbConnected, botGuilds: [], demo: !dbConnected });
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

app.get("*", (req, res) => {
  if (req.path.startsWith("/api/") || req.path.startsWith("/auth/")) return;
  if (req.path === "/dashboard.html" && (!req.session || !req.session.user)) {
    return res.redirect("/");
  }
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`[REVO Dashboard] Running on http://localhost:${PORT}`);
  console.log(`[REVO Dashboard] Login URL: ${getAuthURL()}`);
});