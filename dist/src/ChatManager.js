import { protoEncode, createDefaultDict } from 'acos-json-encoder';
import ACOSDictionary from 'shared/model/acos-dictionary.json' with { type: 'json' };
createDefaultDict(ACOSDictionary);
import storage from './storage.js';
import mq from 'shared/services/rabbitmq.js';
import Filter from 'bad-words';
const filter = new Filter();
import urlRegexSafe from 'url-regex-safe';
const urlChecker = urlRegexSafe({ exact: true });
const MAX_CHAT_HISTORY = 30;
class ChatManager {
    constructor() {
        this.messageHistory = [];
    }
    async start() {
        if (!mq.isActive()) {
            setTimeout(this.start.bind(this), 2000);
            return;
        }
        setTimeout(async () => {
            let qWS = await mq.findExistingQueue("chat");
            await mq.subscribeQueue(qWS, this.onChatReceive.bind(this));
            let queueKey = await mq.subscribe("chat", "chat", this.onChatReceive.bind(this), qWS);
        }, 5000);
    }
    watchChat(ws) {
        ws.subscribe("acos");
        if (this.messageHistory.length === 0)
            return;
        let msg = { type: "chat", payload: this.messageHistory };
        ws.send(protoEncode(msg), true, false);
    }
    onChatReceive(msg) {
        let app = storage.getWSApp();
        console.log("Broadcasting chat message:", msg);
        let channel = "acos";
        if (msg?.payload?.room_slug) {
            channel = msg.payload.room_slug;
        }
        app.publish(channel, protoEncode(msg), true, false);
    }
    async onChatSend(ws, action) {
        if (!ws.user || !ws.user.displayname)
            return null;
        if (ws.loggedIn === "LURKER")
            return null;
        if (!action.payload)
            return null;
        if (!action.payload.message || typeof action.payload.message !== "string")
            return null;
        if (urlChecker.test(action.payload.message)) {
            console.warn("Found URL in message: ", action.payload.message);
            return null;
        }
        let displayname = ws.user.displayname;
        let game_slug = action.payload.game_slug || undefined;
        let room_slug = action.payload.room_slug || undefined;
        let message = action.payload.message;
        message = message.substring(0, 120);
        let portraitid = ws.user.portraitid;
        let countrycode = ws.user.countrycode;
        let payload = {
            displayname,
            portraitid,
            countrycode,
            room_slug,
            message,
            timestamp: new Date().getTime(),
        };
        let response = { type: "chat", payload };
        mq.publish("chat", "chat", response);
        if (room_slug)
            return null;
        this.messageHistory.push(payload);
        if (this.messageHistory.length > MAX_CHAT_HISTORY) {
            this.messageHistory = this.messageHistory.slice(this.messageHistory.length - MAX_CHAT_HISTORY, this.messageHistory.length);
        }
        return null;
    }
}
export default new ChatManager();
//# sourceMappingURL=ChatManager.js.map