import "dotenv/config";
import express from "express";
import session from "express-session";
import cors from "cors";
import mongoose from "mongoose";
import { Client, GatewayIntentBits, PermissionsBitField } from "discord.js";

const app=express();
const port=Number(process.env.PORT||3000);
const clientId=process.env.DISCORD_CLIENT_ID;
const clientSecret=process.env.DISCORD_CLIENT_SECRET;
const redirectUri=process.env.DISCORD_REDIRECT_URI;
const ownerIds=(process.env.OWNER_IDS||"").split(",").map(x=>x.trim()).filter(Boolean);

if(!process.env.DISCORD_BOT_TOKEN || !clientId || !clientSecret || !process.env.MONGODB_URI){
  console.warn("Missing required environment variables. Copy .env.example to .env.");
}

app.use(cors({origin:true,credentials:true}));
app.use(express.json({limit:"2mb"}));
app.use(session({
  secret:process.env.SESSION_SECRET||"change-me",
  resave:false,saveUninitialized:false,
  cookie:{httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production",maxAge:86400000}
}));
app.use(express.static("public"));

const settingsSchema=new mongoose.Schema({
  guildId:{type:String,index:true,unique:true},
  premium:{active:{type:Boolean,default:false},expiresAt:{type:Date,default:null},ownerId:{type:String,default:null}},
  prefix:{type:String,default:"?"},
  commands:{type:Map,of:Boolean,default:{}},
  systems:{type:Map,of:Boolean,default:{}},
  config:{type:mongoose.Schema.Types.Mixed,default:{}}
},{timestamps:true});
const GuildSettings=mongoose.model("GuildSettings",settingsSchema);

const bot=new Client({intents:[GatewayIntentBits.Guilds]});
bot.once("ready",()=>console.log(`Revo dashboard bot: ${bot.user.tag}`));
bot.login(process.env.DISCORD_BOT_TOKEN).catch(e=>console.error("Discord login failed:",e.message));

function requireAuth(req,res,next){
  if(!req.session.user) return res.status(401).json({error:"LOGIN_REQUIRED"});
  next();
}
async function getGuild(req,res,next){
  const guild=bot.guilds.cache.get(req.params.guildId);
  if(!guild) return res.status(404).json({error:"BOT_NOT_IN_GUILD"});
  const member=await guild.members.fetch(req.session.user.id).catch(()=>null);
  const owner=ownerIds.includes(req.session.user.id);
  const admin=member?.permissions.has(PermissionsBitField.Flags.Administrator);
  const isOwner=guild.ownerId===req.session.user.id;
  if(!owner&&!admin&&!isOwner) return res.status(403).json({error:"NO_PERMISSION"});
  req.guild=guild; req.isBotOwner=owner; next();
}

app.get("/auth/discord",(req,res)=>{
  const scope=encodeURIComponent("identify guilds");
  res.redirect(`https://discord.com/oauth2/authorize?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scope}`);
});
app.get("/auth/discord/callback",async(req,res)=>{
  try{
    const body=new URLSearchParams({client_id:clientId,client_secret:clientSecret,grant_type:"authorization_code",code:req.query.code,redirect_uri:redirectUri});
    const token=await fetch("https://discord.com/api/oauth2/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body}).then(r=>r.json());
    if(!token.access_token) throw new Error("OAuth token exchange failed");
    const user=await fetch("https://discord.com/api/users/@me",{headers:{Authorization:`Bearer ${token.access_token}`}}).then(r=>r.json());
    req.session.user={id:user.id,username:user.username,global_name:user.global_name||user.username,avatar:user.avatar};
    res.redirect("/");
  }catch(e){res.status(500).send("Discord login failed.");}
});
app.post("/auth/logout",(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get("/api/me",(req,res)=>res.json({user:req.session.user||null,bot:bot.user?{id:bot.user.id,tag:bot.user.tag}:null}));

app.get("/api/guilds",requireAuth,async(req,res)=>{
  const guilds=[];
  for(const g of bot.guilds.cache.values()){
    const owner=g.ownerId===req.session.user.id;
    const member=await g.members.fetch(req.session.user.id).catch(()=>null);
    const admin=member?.permissions.has(PermissionsBitField.Flags.Administrator);
    const botOwner=ownerIds.includes(req.session.user.id);
    if(owner||admin||botOwner){
      const s=await GuildSettings.findOne({guildId:g.id}).lean()||{premium:{active:false}};
      guilds.push({id:g.id,name:g.name,icon:g.iconURL({size:64}),owner,isAdmin:!!admin,isBotOwner:botOwner,premium:s.premium});
    }
  }
  res.json(guilds);
});
app.get("/api/guilds/:guildId",requireAuth,getGuild,async(req,res)=>{
  const s=await GuildSettings.findOneAndUpdate({guildId:req.params.guildId},{$setOnInsert:{guildId:req.params.guildId}},{upsert:true,new:true}).lean();
  res.json({guild:{id:req.guild.id,name:req.guild.name,icon:req.guild.iconURL({size:128})},settings:s,premium:!!s.premium?.active});
});
app.put("/api/guilds/:guildId/settings",requireAuth,getGuild,async(req,res)=>{
  const allowed=["prefix","commands","systems","config"];
  const update={};
  for(const k of allowed) if(req.body[k]!==undefined) update[k]=req.body[k];
  const s=await GuildSettings.findOneAndUpdate({guildId:req.params.guildId},{$set:update,$setOnInsert:{guildId:req.params.guildId}},{upsert:true,new:true});
  res.json({ok:true,settings:s});
});
app.get("/api/guilds/:guildId/premium",requireAuth,getGuild,async(req,res)=>{
  const s=await GuildSettings.findOne({guildId:req.params.guildId}).lean();
  res.json({active:!!s?.premium?.active,expiresAt:s?.premium?.expiresAt||null,ownerId:s?.premium?.ownerId||null});
});

app.get("*",(req,res)=>res.sendFile(process.cwd()+"/public/index.html"));
mongoose.connect(process.env.MONGODB_URI).then(()=>console.log("MongoDB connected")).catch(e=>console.error("MongoDB:",e.message));
app.listen(port,()=>console.log(`Revo Dashboard: http://localhost:${port}`));