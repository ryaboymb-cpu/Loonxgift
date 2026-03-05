let multi=1
let running=false
let crash=0

setTimeout(()=>{

openScreen("games")

},8000)

function openScreen(id){

document.querySelectorAll(".screen").forEach(s=>{

s.classList.remove("active")

})

document.getElementById(id).classList.add("active")

}

function openRocket(){

openScreen("rocket")

}

function openMines(){

openScreen("mines")

}

function startCrash(){

if(running) return

running=true

multi=1

crash=(Math.random()*5)+1.5

let rocket=document.getElementById("rocketImg")

let game=setInterval(()=>{

multi+=0.05

document.getElementById("multi").innerText=multi.toFixed(2)+"x"

rocket.style.transform="translateY(-"+multi*10+"px)"

if(multi>=crash){

clearInterval(game)

document.getElementById("multi").innerText="CRASH"

running=false

}

},100)

}

function cashout(){

if(!running)return

running=false

alert("Win "+multi.toFixed(2)+"x")

}

function startMines(){

let grid=document.getElementById("mineGrid")

grid.innerHTML=""

for(let i=0;i<25;i++){

let cell=document.createElement("button")

cell.innerText="?"

cell.onclick=()=>{

cell.innerText="💎"

}

grid.appendChild(cell)

}

}
