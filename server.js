const express = require("express")
const http = require("http")
const {Server} = require("socket.io")
const mongoose = require("mongoose")
require("dotenv").config()

const app = express()
const server = http.createServer(app)
const io = new Server(server)

app.use(express.static("public"))
app.use(express.json())

mongoose.connect(process.env.MONGO_URI)

let online = 0

io.on("connection",(socket)=>{

online++

io.emit("online",online)

socket.on("disconnect",()=>{

online--

io.emit("online",online)

})

})

server.listen(3000,()=>{

console.log("Server started")

})
