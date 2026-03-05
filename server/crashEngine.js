function generate(){

const crash = (Math.random()*10+1).toFixed(2)

return {
multiplier:crash
}

}

module.exports = {generate}
