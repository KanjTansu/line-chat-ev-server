'use strict';

const express = require('express');
const fs = require('fs');
const _ = require('lodash');
require('dotenv').config();
const line = require('@line/bot-sdk');
const lineHttpClientConfig = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};
// create LINE SDK client
const client = new line.messagingApi.MessagingApiClient(lineHttpClientConfig);

// Connect Mongo
const mongoose = require('mongoose');
const mongoAuthentication = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
};
const mongoUri = `mongodb+srv://${mongoAuthentication.user}:${mongoAuthentication.password}@evchargerproject.grs7qfu.mongodb.net/ev-charger?retryWrites=true&w=majority&appName=EVChargerProject`;
const Distance = require('./model');
mongoose.connect(mongoUri);

const app = express();

app.get('/get-history', async (req, res) => {
  const data = await Distance.find({}, {}, { sort: { createdAt: -1 } });
  res.header('Content-Type', 'application/json');
  res.send(JSON.stringify(data));
});

// webhook callback
app.post('/webhook', line.middleware(lineHttpClientConfig), (req, res) => {
  // req.body.events should be an array of events
  if (!Array.isArray(req.body.events)) {
    return res.status(500).end();
  }
  // handle events separately
  Promise.all(
    req.body.events.map(async (event) => {
      return await handleEvent(event);
    })
  )
    .then(() => res.end())
    .catch((err) => {
      console.error(err);
      res.status(500).end();
    });
});

// simple reply function
const replyText = (replyToken, text, quoteToken) => {
  return client.replyMessage({
    replyToken,
    messages: [
      {
        type: 'text',
        text,
        quoteToken,
      },
    ],
  });
};

// callback function to handle a single event
async function handleEvent(event) {
  switch (event.type) {
    case 'message':
      const message = event.message;
      switch (message.type) {
        case 'text':
          return await handleText(
            message,
            event.replyToken,
            event.source.userId
          );
        case 'image':
          return handleImage(message, event.replyToken);
        case 'video':
          return handleVideo(message, event.replyToken);
        case 'audio':
          return handleAudio(message, event.replyToken);
        case 'location':
          return handleLocation(message, event.replyToken);
        case 'sticker':
          return handleSticker(message, event.replyToken);
        default:
          throw new Error(`Unknown message: ${JSON.stringify(message)}`);
      }

    case 'follow':
      return replyText(event.replyToken, 'Got followed event');

    case 'unfollow':
      return console.log(`Unfollowed this bot: ${JSON.stringify(event)}`);

    case 'join':
      return replyText(event.replyToken, `Joined ${event.source.type}`);

    case 'leave':
      return console.log(`Left: ${JSON.stringify(event)}`);

    case 'postback':
      let data = event.postback.data;
      return replyText(event.replyToken, `Got postback: ${data}`);

    case 'beacon':
      const dm = `${Buffer.from(event.beacon.dm || '', 'hex').toString(
        'utf8'
      )}`;
      return replyText(
        event.replyToken,
        `${event.beacon.type} beacon hwid : ${event.beacon.hwid} with device message = ${dm}`
      );

    default:
      throw new Error(`Unknown event: ${JSON.stringify(event)}`);
  }
}

async function saveToFile(price, km) {
  const savedData = new Distance({
    price: +price,
    km: +km,
    createAt: new Date(),
  });
  const response = { status: true };
  const lastData = await Distance.findOne({}, {}, { sort: { createdAt: -1 } });
  console.log('lastData', lastData);
  console.log('savedData', savedData);

  if (!lastData) {
    await Distance.create(savedData);
    return response;
  }

  response.lastKm = lastData.km;
  if (lastData.km >= km) {
    response.status = false;
    return response;
  }

  await Distance.create(savedData);
  response.totalKm = km - lastData.km;
  response.cost = price / response.totalKm;
  return response;
}

async function removeInFile(km) {
  const response = { status: true };
  try {
    await Distance.findOneAndDelete({ km });
    return response;
  } catch (error) {
    console.log(error);
    response.status = false;
    return response;
  }
}

async function handleText(message, replyToken, userId) {
  const lowerCaseMessage = message.text.toLowerCase();
  if (
    !lowerCaseMessage.includes('save') &&
    !lowerCaseMessage.includes('cancel') &&
    !lowerCaseMessage.includes('history')
  )
    return replyText(replyToken, 'ไม่สามารถทำรายการนี้ได้', message.quoteToken);

  if (lowerCaseMessage.includes('save'))
    return await saveFunction(message, replyToken, userId);

  if (lowerCaseMessage.includes('cancel'))
    return await cancelSave(message, replyToken, userId);

  if (lowerCaseMessage.includes('history'))
    return await getHistory(message, replyToken, userId);
}

async function saveFunction(message, replyToken, userId) {
  const [save, price, km] = message.text.split(' ');
  if (!price || !km)
    return replyText(replyToken, 'ไม่สามารถทำรายการนี้ได้', message.quoteToken);

  const response = await saveToFile(price, km);
  if (!response.status)
    return replyText(
      replyToken,
      `ไม่สามารถทำรายการนี้ได้ กิโลเมตรที่แล้วคือ ${response.lastKm}`,
      message.quoteToken
    );

  if (!response?.cost)
    return client.pushMessage({
      to: userId,
      messages: [
        {
          type: 'text',
          text: 'บันทึกค่าชาร์จครั้งแรกสำเร็จ',
          quoteToken: message.quoteToken,
        },
      ],
    });

  return client.pushMessage({
    to: userId,
    messages: [
      {
        type: 'text',
        text: `บันทึกค่าชาร์จสำเร็จ ใช้งานไปทั้งหมด ${response.totalKm} กิโลเมตร คิดเป็นกิโลเมครละ ${response.cost} บาท`,
        quoteToken: message.quoteToken,
      },
    ],
  });
}

async function cancelSave(message, replyToken, userId) {
  const [cancel, km] = message.text.split(' ');
  if (!km)
    return replyText(replyToken, 'ไม่สามารถทำรายการนี้ได้', message.quoteToken);

  const response = await removeInFile(km);
  if (!response.status)
    return replyText(
      replyToken,
      `ไม่สามารถทำรายการนี้ได้ ไม่พบกิโลเมตรที่ยกเลิก`,
      message.quoteToken
    );

  return client.pushMessage({
    to: userId,
    messages: [
      {
        type: 'text',
        text: `ยกเลิกบันทึกค่าชาร์จกิโลเมตรที่ ${km} สำเร็จ`,
        quoteToken: message.quoteToken,
      },
    ],
  });
}
async function getHistory(message, replyToken, userId) {
  const data = await Distance.find();
  const textArray = data
    .map((el) => `กิโลเมตรที่ ${el.km} เติมไปที่ราคา ${el.price} บาท`)
    .join('\n');

  return client.pushMessage({
    to: userId,
    messages: [
      {
        type: 'text',
        text: textArray || 'ไม่พบข้อมูลในระบบ',
        quoteToken: message.quoteToken,
      },
    ],
  });
}

function handleImage(message, replyToken) {
  return replyText(replyToken, 'Got Image');
}

function handleVideo(message, replyToken) {
  return replyText(replyToken, 'Got Video');
}

function handleAudio(message, replyToken) {
  return replyText(replyToken, 'Got Audio');
}

function handleLocation(message, replyToken) {
  return replyText(replyToken, 'Got Location');
}

function handleSticker(message, replyToken) {
  return replyText(replyToken, 'Got Sticker');
}

const port = process.env.PORT;
app.listen(port, async () => {
  console.log(`listening on ${port}`);
});
