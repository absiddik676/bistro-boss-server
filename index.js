const express = require('express');
const app = express()
const cors = require('cors');
require('dotenv').config()
const jwt = require('jsonwebtoken');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.PAYMENT_SECRET_KEY)

app.use(express.static("public"));
app.use(express.json());


const port = process.env.PORT || 5000;


// middleware
app.use(express.json())
app.use(cors())

const verifyJWT = (req, res, next) => {
  const authorization = req.headers.authorization;
  if (!authorization) {
    return res.status(401).send({ error: true, message: 'unauthorized access' })
  }
  const token = authorization.split(' ')[1];
  jwt.verify(token, process.env.ACCESS_TOKEN, (error, decoded) => {
    if (error) {
      return res.status(401).send({ error: true, message: 'unauthorized access' })
    }
    req.decoded = decoded;
    next()
  })
}


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.l9yjteg.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const menuCollection = client.db('bistroDB').collection('menu')
    const usersCollection = client.db('bistroDB').collection('usees')
    const reviewsCollection = client.db('bistroDB').collection('reviews')
    const cartCollection = client.db('bistroDB').collection('carts')
    const paymentCollection = client.db('bistroDB').collection('payments')

    // jwt token
    app.post('/jwt', (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN, { expiresIn: '1h' })
      res.send({ token })
    })

    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      if (user?.role !== 'admin') {
        res.status(403).send({ error: true, message: 'forbidden access' })
      }
      next()
    }

    // user related api

    app.get('/users', verifyJWT, async (req, res) => {
      const result = await usersCollection.find().toArray();
      res.send(result)
    })

    app.post('/users', verifyJWT, verifyAdmin, async (req, res) => {
      const user = req.body;
      const query = { email: user.email };
      const existingUser = await usersCollection.findOne(query);
      if (existingUser) {
        return res.send({ message: 'user already exist' })
      }
      const result = await usersCollection.insertOne(user);
      res.send(result)
    })

    app.patch('/users/admin/:id', async (req, res) => {
      const id = req.params;
      const filter = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          role: 'admin'
        },
      };
      const result = await usersCollection.updateOne(filter, updateDoc,);
      res.send(result)
    })

    app.get('/user/admin/:email', verifyJWT, async (req, res) => {
      const email = req.params.email;
      const decodedEmail = req.decoded.email;
      if (email !== decodedEmail) {
        res.status(403).send({ error: true, message: 'forbidden access' })
      }
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      const result = { admin: user?.role === 'admin' };
      res.send(result)
    })

    app.delete('/user/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const result = await usersCollection.deleteOne(query);
      res.send(result)
    })




    // menu related  api
    app.get('/menu', async (req, res) => {
      const result = await menuCollection.find().toArray();
      res.send(result)
    })

    app.post('/menu', verifyJWT, verifyAdmin, async (req, res) => {
      const data = req.body;
      const result = await menuCollection.insertOne(data)
      res.send(result)
    })

    app.delete('/menu/:id', verifyJWT, verifyJWT, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const result = await menuCollection.deleteOne(query);
      res.send(result)
    })

    // review related  api
    app.get('/reviews', async (req, res) => {
      const result = await reviewsCollection.find().toArray();
      res.send(result)
    })

    // cart collection

    app.get('/carts', verifyJWT, async (req, res) => {
      const email = req.query.email;
      if (!email) {
        res.send([])
      }
      const decodedEmail = req.decoded.email;
      if (email !== decodedEmail) {
        res.status(403).send({ error: true, message: 'forbidden access' })
      }
      else {
        const query = { email: email };
        const result = await cartCollection.find(query).toArray()
        res.send(result)
      }
    })

    app.post('/carts', async (req, res) => {
      const item = req.body;
      console.log(item);
      const result = await cartCollection.insertOne(item)
      res.send(result)
    })

    app.delete('/carts/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const result = await cartCollection.deleteOne(query);
      res.send(result)
    })

    // payment
    app.post('/create-payment-intent', verifyJWT, async (req, res) => {
      const { price } = await req.body;
      const amount = parseFloat(price * 100);
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: 'jpy',
        payment_method_types: ['card']
      });
      res.send({
        clientSecret: paymentIntent.client_secret
      })
    })

    // payment related api
    app.post('/payments', verifyJWT, async (req, res) => {
      const payment = req.body;
      const insertResult = await paymentCollection.insertOne(payment)

      const query = { _id: { $in: payment.itemID.map(id => new ObjectId(id)) } }
      const deleteResult = await cartCollection.deleteMany(query)
      res.send({ insertResult, deleteResult })
    })

    // admin dashboard
    app.get('/admin-statue',verifyJWT,verifyAdmin, async (req, res) => {
      const user = await usersCollection.estimatedDocumentCount();
      const product = await menuCollection.estimatedDocumentCount();
      const orders = await paymentCollection.estimatedDocumentCount();
      const payments = await paymentCollection.find().toArray();
      const revenue = payments.reduce((sum,payment)=>sum+payment.price,0)
      res.send({
        user,
        product,
        orders,
        revenue
      })
    })

    app.get('/oder-status',async(req,res)=>{
      const pipeline = [
        {
          $lookup:{
            from:'menu',
            localField:'menuItems',
            foreignField:'_id',
            as:'menuItemsData',
          }
        },
        {
          $unwind:'$menuItemsData'
        },
        {
          $group:{
            _id:"$menuItemsData.category",
            count:{$sum:'$menuItemsData.price'}
          }
        }
      ];
      const result = await paymentCollection.aggregate(pipeline).toArray()
      res.send(result)
    })


    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);


app.get('/', (req, res) => {
  res.send('Boss is sitting')
})

app.listen(port, () => {
  console.log('bistro boss sitting on port 5000');
})