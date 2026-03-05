let users = {}

function get(user){

if(!users[user]) users[user] = 1000

return users[user]

}

function bet(user,amount){

if(!users[user]) users[user] = 1000

if(users[user] < amount){

return {error:"not enough balance"}

}

users[user] -= amount

return {balance:users[user]}

}

module.exports = {get,bet}
