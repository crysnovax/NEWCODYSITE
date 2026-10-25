# CRYSNOVA AI Raw CDN Plugin

This handbook explains how to add the supplied `raw` plugin to a CODY or CRYSNOVA AI bot. The plugin uploads text or code to the CRYSNOVA CDN and returns a raw URL that can be copied and reused.

## What the plugin does

The command supports three input methods:

1. Reply to a text or code message and send `.raw`.
2. Send text directly after the command, for example `.raw console.log("hello world");`.
3. Send a multiline Markdown code block after `.raw`.

The plugin removes Markdown code fences, uploads the cleaned content to the configured CDN, converts the returned URL to a raw URL where supported, and sends the result back with a copy action.

## Required dependencies

Install the dependencies in the project that loads the plugin:

```bash
npm install axios form-data
```

The plugin also expects the project to expose the existing configuration module at:

```text
settings/config.js
```

The CDN address is read in this order:

```text
CDN_URL environment variable → settings/config.js api.cdn value
```

Set it explicitly when deploying:

```bash
export CDN_URL="https://cdn.crysnovax.link"
```

For a persistent VPS deployment, place the value in the process manager environment or in the project `.env` file. Do not commit secrets or private CDN credentials.

## Copy-ready plugin file

Save the following as the plugin file used by your bot, for example:

```text
plugins/raw.js
```

```js
const axios = require('axios');
const FormData = require('form-data');
const config = require('../../../settings/config');

const CDN_URL = process.env.CDN_URL || config.api?.cdn || '';

module.exports = {
    name: 'raw',
    alias: ['paste', 'textcdn', 'bin'],
    category: 'Tools',
    desc: 'Upload raw text/code to CRYSNOVA CDN and get a raw link',
    usage: '.raw <text or reply to text/code>',

    execute: async (sock, m, { reply, text, quoted }) => {
        let content = '';

        // Priority 1: replied text/code message
        const target = quoted || m.quoted;
        if (target && (target.text || target.body || target.message?.conversation)) {
            content = target.text || target.body || target.message?.conversation || '';
        }
        // Priority 2: text after command
        else if (text && text.trim().length > 0) {
            content = text.trim();
        }
        else {
            return reply(
                `⚉ _*Usage:*_\n\n` +
                `_*➊. Reply to a text/code message:*_\n` +
                `   .raw\n\n` +
                `_*➋. Type directly:*_\n` +
                `   .raw console.log("hello world");\n\n` +
                `_*➌. For multi-line code:*_\n` +
                `   .raw \`\`\`js\n   const x = 1;\n   console.log(x);\n   \`\`\``
            );
        }

        // Clean up markdown code blocks if present
        let cleanContent = content;
        if (content.startsWith('```') && content.endsWith('```')) {
            cleanContent = content.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '');
        }

        if (!cleanContent.trim()) {
            return reply('`✘ No content to upload`');
        }

        try {
            await sock.sendMessage(m.chat, { react: { text: '📤', key: m.key } });

            const form = new FormData();
            form.append('file', Buffer.from(cleanContent), {
                filename: 'paste.txt',
                contentType: 'text/plain',
            });

            const res = await axios.post(`${CDN_URL}/upload`, form, {
                headers: form.getHeaders(),
                timeout: 60000,
            });

            const url = res.data?.url;
            if (!url) return reply('`✘ No URL returned`');

            const rawUrl = url.replace(/\/(upload|file)\//, '/raw/').replace(/\.html?$/, '.txt');

            await sock.sendMessage(m.chat, {
                text: `⎙ *Pasted!*\n\n▽ ❏ _Tap button below to copy URL_`,
                nativeFlow: [{
                    text: '📋 Copy URL',
                    copy: rawUrl
                }]
            }, { quoted: m });

        } catch (err) {
            console.error('[RAW]', err.message);
            reply('✘ Upload failed — CDN might not support text uploads');
        }
    }
};
```

## Install and enable

From the bot project directory:

```bash
npm install axios form-data
```

Copy the file into the plugin directory used by your bot. If the project loads plugins automatically, restart the bot. If it uses a plugin registry, add the module to that registry using the project’s normal plugin convention.

For a local test:

```bash
CDN_URL="https://cdn.crysnovax.link" node index.js
```

For PM2:

```bash
CDN_URL="https://cdn.crysnovax.link" pm2 restart cody --update-env
pm2 save
```

## Usage examples

Reply to a message containing code:

```text
.raw
```

Upload one line of code:

```text
.raw console.log("hello world");
```

Upload multiline code:

```text
.raw ```js
const x = 1;
console.log(x);
```
```

## Troubleshooting

If the bot replies `No content to upload`, send `.raw` as a reply to a text/code message or provide text after the command.

If the bot replies `No URL returned`, check the CDN response body and confirm that the `/upload` endpoint returns a JSON object containing `url`.

If the upload times out, confirm the CDN is reachable from the deployment host and that the process can make outbound HTTPS requests.

If the plugin cannot load `settings/config`, verify the relative path from the plugin file to the project configuration module.

Never put bot tokens, OAuth secrets, or private API keys inside the plugin source or into a public plugin submission.
