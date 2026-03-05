let multiplier = 1
let crashed = false

const canvas = document.getElementById("graph")
const ctx = canvas.getContext("2d")

canvas.width = window.innerWidth
canvas.height = 300

let x = 0
let y = canvas.height

function startGame(){

multiplier = 1
crashed = false
x = 0
y = canvas.height

ctx.clearRect(0,0,canvas.width,canvas.height)

gameLoop()

}

function gameLoop(){

if(crashed) return

multiplier += 0.02

document.getElementById("multiplier").innerText =
multiplier.toFixed(2) + "x"

x += 5
y -= multiplier

ctx.lineWidth = 3
ctx.strokeStyle = "#00ffa6"

ctx.lineTo(x,y)
ctx.stroke()

if(Math.random() < 0.01){

crash()

}

requestAnimationFrame(gameLoop)

}

function crash(){

crashed = true

addHistory(multiplier.toFixed(2))

setTimeout(startGame,2000)

}

function addHistory(value){

const history = document.getElementById("history")

const el = document.createElement("div")

el.innerText = value+"x"

history.prepend(el)

}

function placeBet(){

const amount = document.getElementById("betAmount").value

fetch("/api/bet",{

method:"POST",
headers:{ "Content-Type":"application/json" },
body:JSON.stringify({
user:"player",
amount:Number(amount)
})

})

}

function cashout(){

alert("cashout at "+multiplier.toFixed(2)+"x")

}

startGame()
