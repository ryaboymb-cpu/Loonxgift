import mongoose from "mongoose"

const userSchema = new mongoose.Schema({

telegramId:String,
username:String,
balance:{
type:Number,
default:0
},

created:{
type:Date,
default:Date.now
}

})

export default mongoose.model("User",userSchema)
