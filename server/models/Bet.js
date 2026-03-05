import mongoose from "mongoose"

const betSchema = new mongoose.Schema({

userId:String,
amount:Number,
game:String,
result:Number,
created:{
type:Date,
default:Date.now
}

})

export default mongoose.model("Bet",betSchema)
