const express = require("express")
const http = require("http")
const { Server } = require("socket.io")
const mongoose = require("mongoose")
require("dotenv").config()

const app = express()
const server = http.createServer(app)

const io = new Server(server,{
cors:{origin:"*"}
})

app.use(express.json())
app.use(express.static("public"))

/*
MONGODB
*/

mongoose.connect(process.env.MONGO_URI)
.then(()=>console.log("MongoDB connected"))
.catch(err=>console.log("Mongo error:",err))

/*
USER MODEL
*/

const User = mongoose.model("User",{

telegramId:String,
username:String,

balanceReal:{
type:Number,
default:0
},

balanceDemo:{
type:Number,
default:1000
}

})

/*
ONLINE SYSTEM
*/

let online = 0

io.on("connection",(socket)=>{

online++

io.emit("online",online)

socket.on("disconnect",()=>{

online--

io.emit("online",online)

})

})

/*
AUTH TELEGRAM
*/

app.post("/api/auth",async(req,res)=>{

const {telegramId,username} = req.body

let user = await User.findOne({telegramId})

if(!user){

user = await User.create({

telegramId,
username

})

}

res.json(user)

})

/*
GET BALANCE
*/

app.get("/api/balance/:id",async(req,res)=>{

const user = await User.findOne({telegramId:req.params.id})

res.json({

real:user.balanceReal,
demo:user.balanceDemo

})

})

/*
CRASH GAME
*/

function generateCrash(){

let r = Math.random()

let crash = (1/(1-r))

return Math.min(crash,10)

}

app.get("/api/crash",async(req,res)=>{

const multiplier = generateCrash()

res.json({multiplier})

})

/*
MINES GAME
*/

app.post("/api/mines",async(req,res)=>{

const {bet} = req.body

let mine = Math.random()<0.2

if(mine){

res.json({result:"lose"})

}else{

res.json({

result:"win",

multiplier:1.3

})

}

})

/*
BET SYSTEM
*/

app.post("/api/bet",async(req,res)=>{

const {telegramId,amount,type} = req.body

const user = await User.findOne({telegramId})

if(type==="demo"){

if(user.balanceDemo<amount){

return res.json({error:"no balance"})

}

user.balanceDemo -= amount

}else{

if(user.balanceReal<amount){

return res.json({error:"no balance"})

}

user.balanceReal -= amount

}

await user.save()

res.json({

demo:user.balanceDemo,
real:user.balanceReal

})

})

/*
WIN SYSTEM
*/

app.post("/api/win",async(req,res)=>{

const {telegramId,amount,type} = req.body

const user = await User.findOne({telegramId})

if(type==="demo"){

user.balanceDemo += amount

}else{

user.balanceReal += amount

}

await user.save()

res.json({

demo:user.balanceDemo,
real:user.balanceReal

})

})

/*
START SERVER
*/

const PORT = process.env.PORT || 3000

server.listen(PORT,()=>{

console.log("Loonx Gifts server running")

})
