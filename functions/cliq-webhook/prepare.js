'use strict';

const fs = require('node:fs');
const path = require('node:path');

const destination = path.join(__dirname, 'lib');
fs.mkdirSync(destination, { recursive: true });
for (const name of ['cliqWebhook', 'cliqInboxService', 'cliqCommands', 'cliqDelivery', 'cliq', 'catalystCliqStorage']) {
  fs.copyFileSync(path.join(__dirname, '..', 'backup', `${name}.js`), path.join(destination, `${name}.js`));
}