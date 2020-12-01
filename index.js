const express = require('express')
const ejs = require('ejs')
var bodyParser = require('body-parser');
var cookieParser = require('cookie-parser');
var bcrypt = require('bcrypt');
const fs = require('fs')
const jdenticon = require("jdenticon");


const app = express()

require('dotenv').config()
const db = require('monk')(process.env.DB_URL)

//database
const users = db.get('users')
const posts = db.get('posts')

users.createIndex('name', { unique: true })

var saltRounds = 10

var tokens = []

app.use(function (req, res, next) {
    if (req.url == '/') return next()
    if (req.url.slice(-1) == '/') {
        res.redirect(req.url.slice(0, -1))
    } else {
        next()
    }
})

app.use(express.static('static', {
    extensions: ['html', 'htm']
}));

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json())

app.use(cookieParser())

app.get('/', function (req, res) {
    var userCookie = req.cookies.token
    var user = findUser(userCookie)

    ejs.renderFile(__dirname + '/pages/index.ejs', { user }, (err, str) => {
        if (err) console.log(err)
        res.send(str)
    })
})


app.get('/login', function (req, res) {
    var userCookie = req.cookies.token
    var user = findUser(userCookie)

    if (!user) {
        ejs.renderFile(__dirname + '/pages/login.ejs', { user }, (err, str) => {
            if (err) console.log(err)
            res.send(str)
        })
    } else {
        res.redirect('/')
    }

})

app.get('/join', function (req, res) {
    var userCookie = req.cookies.token
    var user = findUser(userCookie)

    if (!user) {
        ejs.renderFile(__dirname + '/pages/join.ejs', { user }, (err, str) => {
            if (err) console.log(err)
            res.send(str)
        })
    } else {
        res.redirect('/')
    }

})

app.get('/logout', function (req, res) {
    var userCookie = req.cookies.token
    var user = findUser(userCookie)

    if (user) {
        tokens = tokens.filter(function (obj) {
            return obj.token !== userCookie;
        });
        res.cookie('token', '')
        res.redirect('/')
    } else {
        res.send('not logged in, how did you get here what is this socery')
    }

})

app.post('/login', async function (req, res) {
    var userCookie = req.cookies.token

    if (!findUser(userCookie)) {
        var username = req.body.username.toLowerCase()
        var password = req.body.password
        const user = await users.findOne({ name: { $regex: new RegExp(username, "i") } });

        if (user) {
            bcrypt.compare(password, user.password, function (err, result) {
                if (result) {
                    var token = makeID(20)
                    tokens.push({ username: user.name, token: token })
                    res.cookie('token', token)
                    res.json({ ok: 'logged in successfully' })
                } else {
                    //password was incorrect
                    res.json({ error: 'incorrect password' })
                }
            });
        } else {
            res.json({ error: 'user not found' })
        }
    } else {
        res.redirect('/')
    }
})

app.post('/join', async function (req, res) {
    var userCookie = req.cookies.token

    if (!findUser(userCookie)) {
        var username = req.body.username.toLowerCase()
        var password = req.body.password

        bcrypt.hash(password, saltRounds, async function (err, hashedPassword) {
            if(err){
                res.json({error: 'password hashing error'})
            } else {
                users.insert({ name: username, password: hashedPassword })
                .then(user => {
                    console.log(user)
                    var token = makeID(20)
                    tokens.push({ username: user.name, token: token })
                    res.cookie('token', token)
                    res.json({ ok: 'made account successfully' })
                })
                .catch(err => {
                    console.log(err)
                    if (err.code == 11000) {
                        res.json({ error: 'username already taken' })
                    } else {
                        res.json({ error: 'uncaught database error: ' + err.code })
                    }
                })
            }
        });
    } else {
        res.redirect('/')
    }
})

app.get('/users', function (req, res) {
    users.find({}).then((docs) => {
        var userList = []
        docs.forEach(i => {
            userList.push({ name: i.name })
        })
        res.json(userList)
    })
})

app.get('/users/:user', async function (req, res, next) {
    var userCookie = req.cookies.token
    var loggedInUser = findUser(userCookie)

    var user = await users.findOne({ name: req.params.user })
    var userPosts = await posts.find({ poster: req.params.user }, { sort: { time: -1, _id:-1 } }) //sort by time but fallback to id


    var post = req.query.post
    //console.log(post) // debug 

    if (user) {
        ejs.renderFile(__dirname + '/pages/user.ejs', { user, loggedInUser, posts: userPosts, activePost: post }, (err, str) => {
            if (err) console.log(err)
            res.send(str)
        })
    } else {
        next() //go to next
    }
})

app.get('/picture/:user', async function (req, res, next) {
    if (fs.existsSync(`./uploads/profiles/${req.params.user}.png`)) {
        res.sendFile(__dirname + `/uploads/profiles/${req.params.user}.png`)
    } else {
        var file = jdenticon.toPng(req.params.user, 128)
        res.set('Content-Type', 'image/png')
        res.send(file)
    }
})

app.get('/posts/:post', async function (req, res) {
    var post = await posts.findOne({ _id: req.params.post })
    res.redirect(`/users/${post.poster}?post=${post._id}`)
})

app.post('/post', async function (req, res) {
    var userCookie = req.cookies.token
    var user = findUser(userCookie)

    if (user) {
        posts.insert({ content: req.body.post, poster: user.username, time: Date.now(), loves: [] })
            .then(post => {
                res.json({ ok: 'made post', id: post._id })
            })
            .catch(err => {
                res.json({ error: 'uncaught error' })
                console.error(error)
            })
    }
})

app.post('/posts/:id/love', async function (req, res) {
    var userCookie = req.cookies.token
    var user = findUser(userCookie)

    if (user) {
        try {
            posts.findOne({ _id: req.params.id })
                .then(post => {
                    if (post) {
                        var loves = post.loves || []
                        if (!loves.includes(user.username)) {
                            loves.push(user.username)
                            posts.update({ _id: req.params.id }, { $set: { loves: loves } })
                                .then(() => {
                                    res.json({ ok: 'loved post', new: loves.length, action: 'love' })
                                })
                                .catch(updateerr => {
                                    console.log(updateerr)
                                    res.json({ error: updateerr })
                                })
                        } else {
                            loves = loves.filter(i => i !== user.username)
                            posts.update({ _id: req.params.id }, { $set: { loves: loves } })
                                .then(() => {
                                    res.json({ ok: 'unloved', new: loves.length, action: 'unlove' })
                                })
                                .catch(updateerr => {
                                    console.log(updateerr)
                                    res.json({ error: updateerr })
                                })
                        }
                    } else {
                        res.json({ eror: 'post not found' })
                    }
                })
                .catch(err => {
                    res.json({ error: err.code })
                })
        } catch {
            res.json({ error: 'oops something went wrong' })
        }
    } else {
        res.json({ error: 'needs to be logged in' })
    }
})

app.use((req, res, next) => { //ALWAYS SHOULD BE LAST
    res.status(404).send(`
    <h1>not found</h1>
    404 - some text about page not being found
    `);
});

function findUser(token) {
    var user = tokens.find(t => t.token == token)
    return user
}

function makeID(length) {
    var result = '';
    var characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    var charactersLength = characters.length;
    for (var i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
}

app.listen(8080);