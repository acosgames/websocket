const { encode } = require('shared/util/encoder');
const storage = require('./storage');
const mq = require('shared/services/rabbitmq');

var Filter = require('bad-words'),
    filter = new Filter();

const urlRegexSafe = require('url-regex-safe');
const urlChecker = urlRegexSafe({ exact: true })
const MAX_CHAT_HISTORY = 30;

const regexURLCheck = new RegExp('([a-zA-Z\d]+://)?((\w+:\w+@)?([a-zA-Z\d.-]+\.[A-Za-z]{2,4})(:\d+)?(/.*)?)', 'i')
class ChatManager {
    constructor() {
        // this.setup();

        this.messageHistory = [];
    }

    async start() {

        if (!mq.isActive()) {
            setTimeout(this.setup.bind(this), 2000);
            return;
        }

        let qWS = await mq.findExistingQueue('chat');
        await mq.subscribeQueue(qWS, this.onChatReceive.bind(this));

        setTimeout(async () => {
            let queueKey = await mq.subscribe('chat', 'chat', this.onChatReceive.bind(this), qWS);
        }, 3000)

        // this.queueKey = await mq.subscribe('ws', 'chat', this.onChat.bind(this), qWS);
    }

    watchChat(ws) {
        // let app = storage.getWSApp();
        ws.subscribe('acos');

        //send them the chat history of last X lines
        if (this.messageHistory.length == 0)
            return;

        let msg = { type: 'chat', payload: this.messageHistory };
        ws.send(encode(msg), true, false);
    }

    onChatReceive(msg) {
        let app = storage.getWSApp();
        console.log("Broadcasting chat message:", msg);
        app.publish('acos', encode(msg), true, false);
    }

    async onChatSend(ws, action) {

        if (!ws.user || !ws.user.displayname)
            return null;

        if (ws.loggedIn == 'LURKER')
            return null;

        if (!action.payload)
            return null;

        if (!action.payload.message || typeof action.payload.message !== 'string')
            return null;


        if (urlChecker.test(action.payload.message)) {
            console.warn("Found URL in message: ", action.payload.message);
            return null;
        }

        let displayname = ws.user.displayname;
        let game_slug = action.payload.game_slug || undefined;
        let message = (action.payload.message);
        message = message.substring(0, 120);
        let icon = undefined;

        let payload = { displayname, message, timestamp: (new Date).getTime(), };

        if (game_slug) {
            let game = await storage.getGameInfo(game_slug);
            if (game) {
                icon = game.preview_images;
                payload.game_slug = game_slug;
                payload.icon = icon;
            }
        }


        let response = { type: 'chat', payload }
        mq.publish('chat', 'chat', response);

        this.messageHistory.push(payload);

        if (this.messageHistory.length > MAX_CHAT_HISTORY) {
            this.messageHistory = this.messageHistory.slice(this.messageHistory.length - MAX_CHAT_HISTORY, this.messageHistory.length);
        }

        return null;
    }

}

module.exports = new ChatManager();