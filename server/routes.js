import express from "express"
import User from "./models/User.js"

const router = express.Router()

router.post("/login",async(req,res)=>{

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

router.get("/balance/:id",async(req,res)=>{

const user = await User.findOne({telegramId:req.params.id})

res.json({balance:user.balance})

})

export default router
