const express = require("express")
const http = require("http")
const { Server } = require("socket.io")
const mongoose = require("mongoose")
require("dotenv").config()

const app = express()
const server = http.createServer(app)

const io = new Server(server,{cors:{origin:"*"}})

app.use(express.json())
app.use(express.static("public"))

mongoose.connect(process.env.MONGO_URI)

/* USER */

const User = mongoose.model("User",{

telegramId:String,
username:String,

balanceTON:{type:Number,default:0},
balanceDemo:{type:Number,default:100},

promoUsed:{type:Boolean,default:false}

})

/* ONLINE */

let online=0

io.on("connection",(socket)=>{

online++
io.emit("online",online)

socket.on("disconnect",()=>{

online--
io.emit("online",online)

})

})

/* AUTH */

app.post("/api/auth",async(req,res)=>{

const {telegramId,username}=req.body

let user=await User.findOne({telegramId})

if(!user){

user=await User.create({telegramId,username})

}

res.json(user)

})

/* BALANCE */

app.get("/api/balance/:id",async(req,res)=>{

const u=await User.findOne({telegramId:req.params.id})

res.json({

ton:u.balanceTON,
demo:u.balanceDemo

})

})

/* BET */

app.post("/api/bet",async(req,res)=>{

const {telegramId,amount,mode}=req.body

const u=await User.findOne({telegramId})

if(mode==="demo"){

if(u.balanceDemo<amount) return res.json({error:true})

u.balanceDemo-=amount

}else{

if(u.balanceTON<amount) return res.json({error:true})

u.balanceTON-=amount

}

await u.save()

res.json({

ton:u.balanceTON,
demo:u.balanceDemo

})

})

/* WIN */

app.post("/api/win",async(req,res)=>{

const {telegramId,amount,mode}=req.body

const u=await User.findOne({telegramId})

if(mode==="demo")
u.balanceDemo+=amount
else
u.balanceTON+=amount

await u.save()

res.json({

ton:u.balanceTON,
demo:u.balanceDemo

})

})

/* PROMO */

app.post("/api/promo",async(req,res)=>{

const {telegramId,code}=req.body

const u=await User.findOne({telegramId})

if(u.promoUsed) return res.json({error:"used"})

if(code!=="LOONX") return res.json({error:"invalid"})

u.balanceTON+=0.1
u.promoUsed=true

await u.save()

res.json({ton:u.balanceTON})

})

/* CRASH ENGINE */

let multiplier=1
let crashPoint=1
let playing=false

function generateCrash(){

let r=Math.random()

return Math.min((1/(1-r)),20)

}

function startRound(){

multiplier=1
crashPoint=generateCrash()

io.emit("crash_start")

playing=true

const game=setInterval(()=>{

multiplier+=0.02

io.emit("crash_tick",multiplier)

if(multiplier>=crashPoint){

io.emit("crash_end",multiplier)

clearInterval(game)

playing=false

setTimeout(startRound,4000)

}

},100)

}

startRound()

/* MINES */

app.post("/api/mines/start",(req,res)=>{

let grid=[]

for(let i=0;i<25;i++){

grid.push(Math.random()<0.2)

}

res.json({grid})

})

/* ADMIN */

app.get("/admin/users",async(req,res)=>{

const users=await User.find()

res.json(users)

})

/* SERVER */

const PORT=process.env.PORT||3000

server.listen(PORT,()=>{

console.log("Loonx Gifts running")

})
