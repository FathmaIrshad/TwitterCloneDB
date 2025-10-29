const express = require('express')
const path = require('path')
const {open} = require('sqlite')
const sqlite3 = require('sqlite3')
const app = express()
app.use(express.json())
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')

const dbPath = path.join(__dirname, 'twitterClone.db')

let db = null

const initializeDBAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    })
    app.listen(3000, () => {
      console.log('Server Running at http://localhost:3000/')
    })
  } catch (e) {
    console.log(`DB Error: ${e.message}`)
    process.exit(1)
  }
}
initializeDBAndServer()

const authenticateToken = (request, response, next) => {
  let jwtToken
  const authHeader = request.headers['authorization']
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(' ')[1]
  }
  if (jwtToken === undefined) {
    response.status(401)
    response.send('Invalid JWT Token')
  } else {
    jwt.verify(jwtToken, 'mySecretCode', async (error, payload) => {
      if (error) {
        response.status(401)
        response.send('Invalid JWT Token')
      } else {
        request.username = payload.username
        next()
      }
    })
  }
}

//API 1
app.post('/register/', async (request, response) => {
  const {username, password, name, gender} = request.body
  if (password.length < 6) {
    response.status(400)
    response.send('Password is too short')
  } else {
    const hashedPassword = await bcrypt.hash(password, 10)
    const selectUserQuery = `
    select * from user where username='${username}' `
    const dbUser = await db.get(selectUserQuery)
    if (dbUser === undefined) {
      const createUserQuery = `
      insert into user (username,name,password,gender)
      values( '${username}','${name}' , '${hashedPassword}', '${gender}') `
      await db.run(createUserQuery)
      response.send('User created successfully')
    } else {
      response.status(400)
      response.send('User already exists')
    }
  }
})

//API2
app.post('/login/', async (request, response) => {
  const {username, password} = request.body
  const selectUserQuery = `
  select * from user where username='${username}' `
  const dbUser = await db.get(selectUserQuery)
  if (dbUser === undefined) {
    response.status(400)
    response.send('Invalid user')
  } else {
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password)
    if (isPasswordMatched === true) {
      const payload = {username: username}
      const jwtToken = jwt.sign(payload, 'mySecretCode')
      response.send({jwtToken})
    } else {
      response.status(400)
      response.send('Invalid password')
    }
  }
})

//API3 Returns the latest tweets of people whom the user follows. Return 4 tweets at a time
app.get('/user/tweets/feed/', authenticateToken, async (request, response) => {
  const getuserTweetsQuery = `
  SELECT user.username, tweet.tweet, tweet.date_time AS dateTime 
  FROM follower 
  INNER JOIN tweet ON follower.following_user_id = tweet.user_id 
  INNER JOIN user ON tweet.user_id = user.user_id 
  WHERE follower.follower_user_id = (SELECT user_id FROM user WHERE username = '${request.username}') 
  ORDER BY tweet.date_time DESC 
  LIMIT 4`
  const userTweetsArray = await db.all(getuserTweetsQuery)
  response.send(userTweetsArray)
})

//API4 Returns the list of all names of people whom the user follows
app.get('/user/following/', authenticateToken, async (request, response) => {
  const getNamesQuery = `
  select user.name from user inner join follower 
  on user.user_id=follower.following_user_id 
  where follower.follower_user_id=
  (select user_id from user where username='${request.username}')`
  const namesArray = await db.all(getNamesQuery)
  response.send(namesArray)
})

//API5 Returns the list of all names of people who follows the user
app.get('/user/followers/', authenticateToken, async (request, response) => {
  const getNamesQuery = `
  select name from user inner join follower 
  on user.user_id=follower.follower_user_id 
  where follower.following_user_id=
  (select user_id from user where username='${request.username}')`
  const namesArray = await db.all(getNamesQuery)
  response.send(namesArray)
})

//API 6 If the user requests a tweet of the user he is following, return the tweet, likes count, replies count and date-time
app.get('/tweets/:tweetId/', authenticateToken, async (request, response) => {
  const {tweetId} = request.params
  const getTweetsQuery = `
  SELECT tweet,
  (SELECT COUNT(*) FROM reply WHERE tweet_id = ${tweetId}) AS replies,
  (SELECT COUNT(*) FROM like WHERE tweet_id = ${tweetId}) AS likes, 
   date_time as dateTime FROM tweet inner join follower 
   on tweet.user_id=follower.following_user_id WHERE tweet.tweet_id = ${tweetId} and  
   follower.follower_user_id=(select user_id from user where username='${request.username}')
   `
  const tweetsArray = await db.get(getTweetsQuery)
  if (tweetsArray === undefined) {
    response.status(401)
    response.send('Invalid Request')
  } else {
    response.send(tweetsArray)
  }
})

//API7 If the user requests a tweet of a user he is following, return the list of usernames who liked the tweet
app.get(
  '/tweets/:tweetId/likes/',
  authenticateToken,
  async (request, response) => {
    const {tweetId} = request.params
    const getTweetsQuery = `
select username as likes from user inner join like on 
user.user_id=like.user_id inner join tweet on 
tweet.tweet_id=like.tweet_id inner join follower on 
follower.following_user_id=tweet.user_id 
where like.tweet_id = ${tweetId} and  
follower.follower_user_id=(select user_id from user where username='${request.username}');`
    const namesArray = await db.all(getTweetsQuery)
    if (namesArray.length === 0) {
      response.status(401)
      response.send('Invalid Request')
    } else {
      // response.send(Object.keys(namesArray).map(key => [namesArray[key]]))
      response.send({likes:namesArray.map(item=>item.likes)})
    }
  },
)

//API 8 If the user requests a tweet of a user he is following, return the list of replies.
app.get(
  '/tweets/:tweetId/replies/',
  authenticateToken,
  async (request, response) => {
    const {tweetId} = request.params
    const getRequestsQuery = `
  select user.name,reply.reply from user inner join reply 
  on reply.user_id=user.user_id inner join tweet 
  on reply.tweet_id=tweet.tweet_id inner join follower 
  on tweet.user_id=follower.following_user_id 
where tweet.tweet_id=${tweetId} and follower.follower_user_id=(select user_id from user where username='${request.username}')
`
    const requestsArray = await db.all(getRequestsQuery)
    if (requestsArray.length === 0) {
      response.status(401)
      response.send('Invalid Request')
    } else {
      response.send({replies:requestsArray})
    }
  },
)

//API 9 Returns a list of all tweets of the user
app.get('/user/tweets/', authenticateToken, async (request, response) => {
  const getUserTweetsQuery = `
select tweet, 
 (select count(*) from like where tweet_id=tweet.tweet_id) as likes,
(select count(*) from reply where tweet_id=tweet.tweet_id) as replies, 
 date_time as dateTime
 from tweet 
 where user_id=(select user_id from user where username='${request.username}') `
  const tweetsArray = await db.all(getUserTweetsQuery)
  response.send(tweetsArray)
})

//API 10 Create a tweet in the tweet table
app.post('/user/tweets/', authenticateToken, async (request, response) => {
  const {tweet} = request.body
  const createTweetQuery = `
   insert into tweet (tweet,user_id,date_time) 
   values (
    '${tweet}',
   (SELECT user_id FROM user WHERE username = '${request.username}'),
    dateTime('now') 
    ) `
  await db.run(createTweetQuery)
  response.send('Created a Tweet')
})

//API11 If the user deletes his tweet
app.delete(
  '/tweets/:tweetId/',
  authenticateToken,
  async (request, response) => {
    let {tweetId} = request.params
    const dbUserExistQuery = `
    select * from tweet where tweet.tweet_id=${tweetId} and tweet.user_id=(select user_id from user where username='${request.username}')
    `
    const dbUserExist = await db.get(dbUserExistQuery)
    if (!dbUserExist) {
      response.status(401)
      response.send('Invalid Request')
    } else {
      const deleteQuery = `
      delete from tweet where tweet.tweet_id=${tweetId} and tweet.user_id=(select user_id from user where username='${request.username}')
      `
      await db.run(deleteQuery)
      response.send('Tweet Removed')
    }
  },
)

module.exports = app
