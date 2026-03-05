import mongoose from "mongoose"

mongoose.connect(process.env.MONGO_URI)

mongoose.connection.on("connected", ()=>{
console.log("MongoDB connected")
})
