const JoinAction = require('./onJoin');
const onLeave = require('./onLeave');
const onSkip = require('./onSkip');
const onPing = require('./onPing');

const { decode } = require('fsg-shared/util/encoder');

const mq = require('fsg-shared/services/rabbitmq');
const storage = require('./storage');
const profiler = require('fsg-shared/util/profiler');

// console.log = () => { };

class Action {

    constructor() {
        this.actions = {};
        this.actions['join'] = JoinAction.onJoin.bind(JoinAction);
        this.actions['leave'] = onLeave;
        this.actions['skip'] = onSkip;
        this.actions['ping'] = onPing;
    }

    async onClientAction(ws, message, isBinary) {
        // profiler.StartTime('ActionUpdateLoop');
        // profiler.StartTime('OnClientAction');
        let unsafeAction = null;
        try {
            unsafeAction = decode(message)
        }
        catch (e) {
            console.error(e);
            return;
        }
        //console.log("Received from Client: [" + ws.user.shortid + "]", unsafeAction);

        if (!unsafeAction || !unsafeAction.type || typeof unsafeAction.type !== 'string')
            return;

        let action = {};
        action.type = unsafeAction.type;
        action.payload = unsafeAction.payload;
        if (unsafeAction.room_slug) {
            action.meta = {}
            action.meta.room_slug = unsafeAction.room_slug;
        }

        action.user = { id: ws.user.shortid };

        if (action.type == 'ping') {
            await onPing(ws, action);
            return;
        }

        let systemAction = this.actions[action.type];
        if (systemAction)
            action = await systemAction(ws, action);
        else
            action = await this.gameAction(ws, action);

        if (!action)
            return;

        let room_slug = (action.meta && action.meta.room_slug) ? action.meta.room_slug : null;
        if (room_slug) {
            let room = await storage.getRoomMeta(room_slug);
            action.meta = this.setupMeta(room);
        }

        await this.forwardAction(action);
        // profiler.EndTime('OnClientAction');
    }

    async gameAction(ws, action) {
        let room_slug = action.meta.room_slug;
        if (!room_slug)
            return null;
        let room = await storage.getRoomMeta(room_slug);
        if (!room)
            return null;

        let roomState = await storage.getRoomState(room_slug);
        if (!roomState)
            return null;

        if (!this.validateUser(ws, roomState))
            return null;

        return action;
    }

    validateUser(ws, roomData) {
        //prevent users from sending actions if not their turn
        if (!roomData)
            return false;
        if (!roomData.next)
            return false;
        if (roomData.next.id == '*')
            return true;
        if (roomData.next.id == ws.user.shortid)
            return true;
        return false;
    }

    async forwardAction(msg) {

        if (!msg.type) {
            console.error("Action is missing, ignoring message", msg);
            return;
        }
        var game_slug = msg.meta.game_slug;
        if (!game_slug)
            return;

        try {
            let exists = await mq.assertQueue(game_slug);
            if (!exists) {
                mq.publishQueue('loadGame', msg)
            }
            mq.publishQueue(game_slug, msg);
        }
        catch (e) {
            console.error(e);
        }
    }

    setupMeta(room) {
        let meta = {};
        meta.room_slug = room.room_slug;
        meta.gameid = room.gameid;
        meta.game_slug = room.game_slug;
        meta.maxplayers = room.maxplayers;
        meta.version = room.version;
        return meta;
    }

}

module.exports = new Action();