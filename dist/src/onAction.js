import JoinAction from './onJoinRequest.js';
import onLeave from './onLeave.js';
import onSkip from './onSkip.js';
import onPing from './onPing.js';
import ChatManager from './ChatManager.js';
import { protoDecode } from 'acos-json-encoder';
import mq from 'shared/services/rabbitmq.js';
import storage from './storage.js';
import profiler from 'shared/util/profiler.js';
import PublicAction from './PublicAction.js';
class Action {
    constructor() {
        this.publicActions = {};
        this.publicActions["getGameQueues"] = PublicAction.getGameQueues.bind(PublicAction);
        this.publicActions["getGameDaily"] = PublicAction.getGameDaily.bind(PublicAction);
        this.publicActions["getGameWeekly"] = PublicAction.getGameWeekly.bind(PublicAction);
        this.publicActions["getGameMonthly"] = PublicAction.getGameMonthly.bind(PublicAction);
        this.publicActions["getGameAllTime"] = PublicAction.getGameAllTime.bind(PublicAction);
        this.system = {};
        this.system["joinqueues"] = JoinAction.onJoinQueues.bind(JoinAction);
        this.system["joingame"] = JoinAction.onJoinGame.bind(JoinAction);
        this.system["leavequeue"] = JoinAction.onLeaveQueue.bind(JoinAction);
        this.system["ping"] = onPing;
        this.system["chat"] = ChatManager.onChatSend.bind(ChatManager);
        this.actions = {};
        this.actions["leave"] = onLeave;
        this.actions["skip"] = onSkip;
        this.actions["pregame"] = onSkip;
        this.actions["type"] = onSkip;
        this.actions["gamestart"] = onSkip;
        this.actions["gameover"] = onSkip;
        this.actions["gamecancelled"] = onSkip;
        this.actions["gameerror"] = onSkip;
    }
    async onClientAction(ws, message, isBinary) {
        profiler.StartTime("ActionUpdateLoop");
        console.log("Receiving message from Client: [" + ws?.user?.shortid + "]");
        let unsafeAction = null;
        try {
            unsafeAction = protoDecode(message);
        }
        catch (e) {
            console.error(e);
            return;
        }
        if (!unsafeAction ||
            !unsafeAction.type ||
            typeof unsafeAction.type !== "string") {
            console.error("Invalid action received from: [" + ws?.user?.shortid + "]", unsafeAction);
            return;
        }
        console.log("Receiving decoded from Client: [" + ws?.user?.shortid + "]", unsafeAction);
        let action = {};
        if (unsafeAction.type === 'gameaction') {
            action.type = unsafeAction.payload.type;
            action.payload = unsafeAction.payload.payload;
            action.room_slug = unsafeAction.payload.room_slug;
        }
        else {
            action.type = unsafeAction.type;
            action.payload = unsafeAction.payload;
            if (unsafeAction?.payload?.room_slug) {
                action.room_slug = unsafeAction.payload.room_slug;
            }
        }
        action.user = { shortid: ws?.user?.shortid };
        let systemAction = this.system[action.type];
        if (systemAction) {
            action = await systemAction(ws, action);
            return;
        }
        let roomState = await storage.getRoomState(action.room_slug);
        if (!roomState)
            return;
        if (roomState?.room?.events?.gameover ||
            roomState?.room?.events?.gamecancelled ||
            roomState?.room?.events?.gameerror)
            return;
        let requestAction = this.actions[action.type];
        if (requestAction)
            action = await requestAction(ws, action);
        else if (action.type === "gameaction")
            action = await this.gameAction(ws, action);
        if (!action)
            return;
        await this.forwardAction(action);
    }
    async gameAction(ws, action) {
        let room_slug = action.room_slug;
        if (!room_slug)
            return null;
        let meta = await storage.getRoomMeta(room_slug);
        if (!meta)
            return null;
        let roomState = await storage.getRoomState(room_slug);
        if (!roomState)
            return null;
        if (!this.validateUser(ws, roomState, action))
            return null;
        return action;
    }
    validateUser(ws, roomState, action) {
        if (!roomState)
            return false;
        if (action.type === "ready") {
            action.payload = true;
            return true;
        }
        let next_id = roomState?.room?.next_id;
        if (!next_id)
            return false;
        let shortid = action.user.shortid;
        let teams = roomState?.teams;
        let passed = this.validateNextUser(shortid, next_id, teams);
        if (passed) {
            return true;
        }
        console.log("User failed validation: ", action);
        return false;
    }
    validateNextUser(userid, nextid, teams) {
        if (typeof nextid === "string") {
            if (nextid === "*")
                return true;
            if (nextid === userid)
                return true;
            if (!teams || !teams[nextid] || !teams[nextid].players)
                return false;
            if (Array.isArray(teams[nextid].players) &&
                teams[nextid].players.includes(userid)) {
                return true;
            }
        }
        else if (Array.isArray(nextid)) {
            if (nextid.includes(userid))
                return true;
            if (!teams)
                return false;
            for (var i = 0; i < nextid.length; i++) {
                let team_slug = nextid[i];
                if (Array.isArray(teams[team_slug].players) &&
                    teams[team_slug].players.includes(userid)) {
                    return true;
                }
            }
        }
        return false;
    }
    async forwardAction(msg) {
        if (!msg.type) {
            console.error("Action is missing, ignoring message", msg);
            return;
        }
        let meta = await storage.getRoomMeta(msg.room_slug);
        var game_slug = meta.game_slug;
        if (!game_slug)
            return;
        try {
            console.log("ForwardAction", Date.now());
            let key = game_slug + "/" + msg.room_slug;
            await mq.publish("action", key, msg);
        }
        catch (e) {
            console.error(e);
        }
    }
}
export default new Action();
//# sourceMappingURL=onAction.js.map