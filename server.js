const express = require("express")
const mongoose = require("mongoose")
const bodyParser = require("body-parser")

const app = express()

app.use(express.json())
app.use(bodyParser.json())
app.use(express.static("public"))

mongoose.connect(process.env.MONGO_URI)

const User = mongoose.model("User",{

telegramId:String,
balanceDemo:{type:Number,default:1000},
balanceReal:{type:Number,default:0},
gamesPlayed:{type:Number,default:0},
profit:{type:Number,default:0}

})

let online = 0

app.get("/api/online",(req,res)=>{
res.json({online})
})

app.post("/api/join",(req,res)=>{
online++
res.json({ok:true})
})

app.post("/api/leave",(req,res)=>{
if(online>0) online--
res.json({ok:true})
})

app.post("/api/user",async(req,res)=>{

let id=req.body.id

let user=await User.findOne({telegramId:id})

if(!user){

user=new User({telegramId:id})

await user.save()

}

res.json(user)

})

app.post("/api/balance",async(req,res)=>{

let id=req.body.id

let user=await User.findOne({telegramId:id})

res.json({

demo:user.balanceDemo,
real:user.balanceReal

})

})

app.post("/api/update",async(req,res)=>{

let {id,demo,real}=req.body

let user=await User.findOne({telegramId:id})

user.balanceDemo=demo
user.balanceReal=real

await user.save()

res.json({ok:true})

})

app.listen(3000,()=>{
console.log("server started")
})
