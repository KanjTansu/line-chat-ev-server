'use strict';

const line = require('@line/bot-sdk');
const express = require('express');
const fs = require('fs');
const _ = require('lodash');
require('dotenv').config();

const lineHttpClientConfig = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};

// create LINE SDK client
const client = new line.messagingApi.MessagingApiClient(lineHttpClientConfig);

const app = express();

app.get('/get-history', (req, res) => {
  const data = getDataFromJson();
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
    req.body.events.map((event) => {
      console.log('event', event);
      return handleEvent(event);
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
function handleEvent(event) {
  switch (event.type) {
    case 'message':
      const message = event.message;
      switch (message.type) {
        case 'text':
          return handleText(message, event.replyToken, event.source.userId);
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

function getDataFromJson() {
  if (!fs.existsSync('./data.json')) return [];
  const data = fs.readFileSync('./data.json', 'utf8');
  const getArrayData = JSON.parse(data);
  return _.orderBy(getArrayData, ['km'], ['desc']);
}

function saveToFile(price, km) {
  const savedData = { price: +price, km: +km, createAt: new Date() };
  const response = { status: true };
  if (!fs.existsSync('./data.json')) {
    fs.writeFileSync('./data.json', JSON.stringify([savedData]));
    return response;
  }
  const data = fs.readFileSync('./data.json', 'utf8');
  const getArrayData = JSON.parse(data);
  const lastData = getArrayData[getArrayData.length - 1];

  if (!lastData || !lastData.length) {
    fs.writeFileSync('./data.json', JSON.stringify([savedData]));
    return response;
  }

  response.lastKm = lastData.km;
  if (lastData.km >= km) {
    response.status = false;
    return response;
  }
  response.totalKm = km - lastData.km;
  response.cost = response.totalKm / price;
  const newData = [...getArrayData, savedData];
  fs.writeFileSync('./data.json', JSON.stringify(newData));
  return response;
}

function removeInFile(km) {
  const response = { status: true };
  if (!fs.existsSync('./data.json')) {
    return response;
  }
  const data = fs.readFileSync('./data.json', 'utf8');
  const getArrayData = JSON.parse(data);
  if (!getArrayData.find((el) => el.km === +km)) {
    response.status = false;
    return response;
  }
  const newData = getArrayData.filter((el) => el.km !== +km);
  fs.writeFileSync('./data.json', JSON.stringify(newData));
  return response;
}

function handleText(message, replyToken, userId) {
  // console.log(message.text);
  if (!message.text.includes('save') && !message.text.includes('cancel'))
    return replyText(replyToken, 'ไม่สามารถทำรายการนี้ได้', message.quoteToken);

  if (message.text.includes('save'))
    return saveFunction(message, replyToken, userId);

  if (message.text.includes('cancel'))
    return cancelSave(message, replyToken, userId);
}

function saveFunction(message, replyToken, userId) {
  const [save, price, km] = message.text.split(' ');
  if (!price || !km)
    return replyText(replyToken, 'ไม่สามารถทำรายการนี้ได้', message.quoteToken);

  const response = saveToFile(price, km);
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

function cancelSave(message, replyToken, userId) {
  const [cancel, km] = message.text.split(' ');
  if (!km)
    return replyText(replyToken, 'ไม่สามารถทำรายการนี้ได้', message.quoteToken);

  const response = removeInFile(km);
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
app.listen(port, () => {
  console.log(`listening on ${port}`);
});
