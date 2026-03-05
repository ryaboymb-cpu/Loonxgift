const express = require("express")
const http = require("http")
const { Server } = require("socket.io")
const mongoose = require("mongoose")
const axios = require("axios")
require("dotenv").config()

const app = express()
const server = http.createServer(app)

const io = new Server(server,{
cors:{origin:"*"}
})

app.use(express.json())
app.use(express.static("public"))

/* ======================
MONGODB
====================== */

mongoose.connect(process.env.MONGO_URI)
.then(()=>console.log("Mongo connected"))
.catch(err=>console.log(err))

/* ======================
USER MODEL
====================== */

const User = mongoose.model("User",{

telegramId:String,
username:String,

balanceTON:{
type:Number,
default:0
},

balanceDemo:{
type:Number,
default:100
},

promoUsed:{
type:Boolean,
default:false
}

})

/* ======================
ONLINE USERS
====================== */

let online = 0

io.on("connection",(socket)=>{

online++

io.emit("online",online)

socket.on("disconnect",()=>{

online--

io.emit("online",online)

})

})

/* ======================
TELEGRAM AUTH
====================== */

app.post("/api/auth",async(req,res)=>{

const {telegramId,username}=req.body

let user=await User.findOne({telegramId})

if(!user){

user=await User.create({
telegramId,
username
})

}

res.json(user)

})

/* ======================
BALANCE
====================== */

app.get("/api/balance/:id",async(req,res)=>{

const user=await User.findOne({telegramId:req.params.id})

res.json({

ton:user.balanceTON,
demo:user.balanceDemo

})

})

/* ======================
TON DEPOSIT CHECK
====================== */

app.post("/api/checkDeposit",async(req,res)=>{

const {telegramId}=req.body

try{

const response = await axios.get(
`https://tonapi.io/v2/blockchain/accounts/${process.env.PROJECT_WALLET}/transactions`,
{
headers:{
Authorization:`Bearer ${process.env.TON_API_KEY}`
}
}
)

const txs=response.data.transactions

let user=await User.findOne({telegramId})

let deposit=0

txs.forEach(tx=>{

if(tx.in_msg){

deposit+=tx.in_msg.value/1000000000

}

})

if(deposit>0){

user.balanceTON+=deposit

await user.save()

}

res.json({
ton:user.balanceTON
})

}catch(e){

res.json({error:true})

}

})

/* ======================
BET
====================== */

app.post("/api/bet",async(req,res)=>{

const {telegramId,amount,mode}=req.body

const user=await User.findOne({telegramId})

if(mode==="demo"){

if(user.balanceDemo<amount)
return res.json({error:"balance"})

user.balanceDemo-=amount

}else{

if(user.balanceTON<amount)
return res.json({error:"balance"})

user.balanceTON-=amount

}

await user.save()

res.json({

ton:user.balanceTON,
demo:user.balanceDemo

})

})

/* ======================
WIN
====================== */

app.post("/api/win",async(req,res)=>{

const {telegramId,amount,mode}=req.body

const user=await User.findOne({telegramId})

if(mode==="demo")
user.balanceDemo+=amount
else
user.balanceTON+=amount

await user.save()

res.json({

ton:user.balanceTON,
demo:user.balanceDemo

})

})

/* ======================
PROMO
====================== */

app.post("/api/promo",async(req,res)=>{

const {telegramId,code}=req.body

const user=await User.findOne({telegramId})

if(user.promoUsed)
return res.json({error:"used"})

if(code!=="LOONX")
return res.json({error:"invalid"})

user.balanceTON+=0.1
user.promoUsed=true

await user.save()

res.json({

ton:user.balanceTON

})

})

/* ======================
CRASH ENGINE
====================== */

let crashMultiplier=1
let crashPoint=1
let crashActive=false

function generateCrash(){

let r=Math.random()

return Math.min((1/(1-r)),20)

}

function startCrash(){

crashMultiplier=1
crashActive=true
crashPoint=generateCrash()

io.emit("crash_start")

const interval=setInterval(()=>{

crashMultiplier+=0.02

io.emit("crash_tick",crashMultiplier)

if(crashMultiplier>=crashPoint){

crashActive=false

io.emit("crash_end",crashMultiplier)

clearInterval(interval)

setTimeout(startCrash,4000)

}

},100)

}

startCrash()

/* ======================
MINES
====================== */

app.post("/api/mines/start",(req,res)=>{

const grid=[]

for(let i=0;i<25;i++){

grid.push(Math.random()<0.2)

}

res.json({grid})

})

/* ======================
ADMIN
====================== */

app.get("/admin/users",async(req,res)=>{

const users=await User.find().limit(100)

res.json(users)

})

/* ======================
SERVER
====================== */

const PORT=process.env.PORT||3000

server.listen(PORT,()=>{

console.log("Loonx Gifts running")

})
