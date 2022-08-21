const { encode } = require('shared/util/encoder');
const storage = require('./storage');
const mq = require('shared/services/rabbitmq');


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

        let displayname = ws.user.displayname;
        let game_slug = action.payload.game_slug;
        let message = action.payload.message;
        let icon = null;
        if (game_slug) {
            let game = await storage.getGameInfo(game_slug);
            if (game) {
                icon = game.preview_images;
            }
        }

        let payload = { displayname, game_slug, message, timestamp: (new Date).getTime(), icon };
        let response = { type: 'chat', payload }
        mq.publish('chat', 'chat', response);

        this.messageHistory.push(payload);

        if (this.messageHistory.length > 100) {
            this.messageHistory = this.messageHistory.slice(this.messageHistory.length - 100, this.messageHistory.length);
        }

        return null;
    }

}

module.exports = new ChatManager();