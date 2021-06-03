
const UWSjs = require('uWebSockets.js/uws');
const uws = UWSjs.App();
const events = require('events');
const auth = require('./authentication');
const { encode, decode } = require('fsg-shared/util/encoder')

const InstanceLocalService = require('fsg-shared/services/instancelocal');
const local = new InstanceLocalService();

const { GeneralError } = require('fsg-shared/util/errorhandler');
const credutil = require('fsg-shared/util/credentials');
const { getLocalAddr } = require('fsg-shared/util/address');

const RedisService = require('fsg-shared/services/redis');
const rabbitmq = require('fsg-shared/services/rabbitmq');

const GameService = require('fsg-shared/services/game');
const g = new GameService();

const cache = require('fsg-shared/services/cache');

const RoomService = require('fsg-shared/services/room');
const r = new RoomService();

class WSNode {

    constructor(options) {
        this.credentials = credutil();

        this.evt = new events.EventEmitter();
        this.port = process.env.PORT || this.credentials.platform.wsnode.port;
        this.redis = RedisService;
        this.mq = rabbitmq;

        this.users = {};
        this.rooms = {};
        this.roomStates = {};

        this.server = {};
        this.cluster = null;
        this.options = options;
    }

    async kickPlayers(msg) {
        let game = msg.payload;
        let players = game.kick;
        for (var id = 0; i < players.length; id++) {
            if (game.players && game.players[id])
                delete game.players[id];
        }

        for (var id = 0; i < players.length; id++) {
            if (!this.users[id])
                continue;
            this.users[id].unsubscribe(msg.meta.room_slug);

            let response = { type: 'kicked', meta: { room_slug: msg.meta.room_slug }, payload: msg.payload }
            let encoded = encode(response);
            this.users[id].send(encoded, true, false);
        }
    }

    async killGameRoom(msg) {

        let game = msg.payload;
        if (!game || !game.players)
            return;

        for (var id in game.players) {
            if (!this.users[id])
                continue;
            this.users[id].unsubscribe(msg.meta.room_slug);
            // let response = { type: 'finish', payload: msg.payload }
            // let encoded = encode(response);
            // this.users[id].send(encoded, true, false);
            // this.users[id].disconnect();
        }

        let room_slug = msg.meta.room_slug;
        if (!room_slug) {
            console.error("Kill Game Room: Error: Missing room_slug");
            return;
        }

        this.cleanupRoom(room_slug);

    }

    async cleanupRoom(room_slug) {
        delete this.rooms[room_slug]
        delete this.roomStates[room_slug];



        r.deleteRoom(room_slug);
    }

    async onRoomUpdate(msg) {
        let room_slug = msg.meta.room_slug;
        if (!room_slug)
            return true;

        try {
            let savedMeta = msg.meta;
            delete msg['meta'];

            if (msg.payload.next)
                this.processTimelimit(msg.payload.next);

            let playerList = Object.keys(msg.payload.players);

            let encoded = encode(msg);
            //let isOver1kb = msgStr.length > 1000;
            this.app.publish(room_slug, encoded, true, false)

            msg.meta = savedMeta;
            this.roomStates[room_slug] = msg;

            setTimeout(() => {
                if (msg.payload.kick) {
                    this.kickPlayers(msg);
                }

                if (msg.type == 'finish' || playerList.length == 0 || msg.payload.killGame) {
                    this.killGameRoom(msg);
                    return true;
                }
            }, 1000)


            return true;
        }
        catch (e) {
            console.error(e);
        }
        return false;
    }

    async onJoinResponse(msg) {
        try {
            console.log("Join Response: ", msg);
            if (!msg.payload.id)
                return true;

            let id = msg.payload.id;
            let room_slug = msg.payload.room_slug;

            let ws = this.users[id];
            if (!ws) {
                console.error("[onJoinResponse] missing websocket for: ", id);
                return true;
            }

            let pending = ws.pending[room_slug];
            if (!pending) {
                console.error("[onJoinResponse] missing pending for: ", id, room_slug);
                //return true;
            }
            else {
                delete ws.pending[room_slug];
            }



            if (msg.type == 'join') {
                console.log("[onJoinResponse] Subscribing and Sending to client.");
                ws.subscribe(room_slug);
                let roomData = await this.getRoomData(room_slug);

                if (roomData) {
                    msg = roomData;
                    msg.type = 'join';
                    msg.meta = await this.getRoom(room_slug);
                    let encoded = encode(msg);
                    ws.send(encoded, true, false);
                } else {
                    console.error("[onJoinResponse] Missing roomdata for join response: ", room_slug);
                }
                return true;
            }

            if (msg.type == 'full') {
                let response = { type: 'gamefull', payload: { room_slug } };
                ws.send(encode(response), true, false);
                return true;
            }

            let response = { type: 'gameinvalid', payload: { room_slug } };
            ws.send(encode(response), true, false);
            return true
        }
        catch (e) {
            console.error(e);
            return false
        }

    }

    async processTimelimit(next) {
        let seconds = next.timelimit;
        seconds = Math.min(60, Math.max(10, seconds));

        let now = (new Date()).getTime();
        let deadline = now + (seconds * 1000);
        next.deadline = deadline;
    }

    async processPing(ws, message) {
        let clientTime = message.payload;
        let serverTime = (new Date()).getTime();
        let offset = serverTime - clientTime;
        let response = { type: 'pong', payload: { offset, serverTime } }
        ws.send(encode(response), true, false);
    }

    validateUser(ws, roomData) {
        //prevent users from sending actions if not their turn
        if (!roomData && !roomData.payload)
            return false;
        if (!roomData.payload.next)
            return false;
        if (roomData.payload.next.id == '*')
            return true;
        if (roomData.payload.next.id == ws.user.shortid)
            return true;
        return false;
    }

    async onClientMessage(ws, message, isBinary) {

        let unsafeAction = null;
        try {
            unsafeAction = decode(message)
        }
        catch (e) {
            console.error(e);
            return;
        }
        console.log("Received from Client: [" + ws.user.shortid + "]", unsafeAction);

        if (!unsafeAction || !unsafeAction.type || typeof unsafeAction.type !== 'string')
            return;

        let action = {};
        action.type = unsafeAction.type;
        action.payload = unsafeAction.payload;
        if (unsafeAction.meta) {
            action.meta = {}
            action.meta.room_slug = unsafeAction.meta.room_slug;
        }


        if (action.type == 'ping') {
            this.processPing(ws, action);
            return;
        }

        action.user = { id: ws.user.shortid };

        //preprocess some of the actions to force certain values
        if (action.type == 'join') {
            await this.requestJoin(ws, action);
            return;
        }

        let room_slug = (action.meta && action.meta.room_slug) ? action.meta.room_slug : null;
        if (!room_slug)
            return;

        if (action.type == 'leave') {

            let room = await this.getRoom(room_slug);
            if (!room)
                return;
            action.payload = {};
            action.meta = this.setupMeta(room);
            this.forwardAction(action);
            return;
        }

        let roomData = await this.getRoomData(room_slug);
        if (!roomData)
            return;

        if (action.type == 'skip ') {
            let deadline = roomData.payload.next.deadline;
            let now = (new Date()).getTime();
            if (now < deadline) {
                return;
            }
            action.payload = {
                id: roomData.payload.next.id,
                deadline, now
            }
        }
        else {
            if (!this.validateUser(ws, roomData))
                return;
        }

        let room = await this.getRoom(room_slug);
        if (!room)
            return;

        action.meta = this.setupMeta(room);
        this.forwardAction(action);
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

    async forwardAction(msg) {

        if (!msg.type) {
            console.error("Action is missing, ignoring message", msg);
            return;
        }
        var game_slug = msg.meta.game_slug;
        if (!game_slug)
            return;

        try {
            let exists = await this.mq.assertQueue(game_slug);
            if (!exists) {
                this.mq.publishQueue('loadGame', msg)
            }
            this.mq.publishQueue(game_slug, msg);
        }
        catch (e) {
            console.error(e);
        }
    }

    async getRoom(room_slug) {
        return await cache.get(room_slug + '/meta');

        let room = this.rooms[room_slug];
        if (!room)
            room = await r.findRoom(room_slug);
        if (!room)
            return null;
        return room;
    }

    async getRoomData(room_slug) {
        return await cache.get(room_slug);
        if (!room_slug)
            return null;
        let roomData = this.roomStates[room_slug];
        if (!roomData) {
            roomData = await this.redis.get(room_slug);
        }
        if (!roomData)
            return null;
        return roomData;
    }

    async cacheRoom(room) {
        this.rooms[room.room_slug] = room;
    }

    async pendingJoin(ws, room) {
        if (!ws.pending)
            ws.pending = {};
        ws.pending[room.room_slug] = true;
    }

    async requestJoin(ws, msg) {
        let isBeta = msg.payload.beta;
        let game_slug = msg.payload.game_slug;

        let room = await r.findAnyRoom(game_slug, isBeta);
        if (!room)
            return;

        console.log("Found room: ", room.game_slug, room.room_slug, room.version);

        //save the room to cache
        // this.cacheRoom(room);

        //track user who is pending a join 
        this.pendingJoin(ws, room);

        //these are used by the gameserver to add the user to specific room
        msg.user.name = ws.user.displayname

        if (!room) {
            let response = { type: 'retry', payload: { type: action.type } }
            ws.send(encode(response));
            return;
        }

        msg.meta = this.setupMeta(room);
        this.forwardAction(msg);

        return;
    }



    async connect(options) {
        options = options || this.options

        this.options = options || {
            idleTimeout: 30,
            maxBackpressure: 1024,
            maxPayloadLength: 1380,
            compression: UWSjs.DEDICATED_COMPRESSOR_3KB,
            upgrade: this.upgrade.bind(this),
            open: this.onClientOpen.bind(this),
            message: this.onClientMessage.bind(this),
            close: this.onClientClose.bind(this)
        }

        await this.register();
        await this.connectToRedis(options);
        await this.connectToMQ(options);

        this.app = uws.ws('/*', this.options)
            .get('/*', this.anyRoute.bind(this))
            // .get('/player/add/*', this.addPlayer.bind(this))
            // .get('/player/redirect/*', this.redirectPlayer.bind(this))
            // .get('/game/*', this.addGame.bind(this))

            .listen(this.port, this.onListen.bind(this));
        return this.app;
    }

    async register() {

        let params = {
            public_addr: this.port,
            private_addr: getLocalAddr() + ':' + this.credentials.platform.wsnode.port,
            hostname: "wsnode",
            zone: 0,
            instance_type: 1
        }
        this.server = await local.register(params);
        console.log("WS Node registered: ", this.server);
        return this.server;
    }


    async connectToMQ(options) {
        if (!this.server || !this.server.clusters) {
            setTimeout(() => { this.connect(options) }, this.credentials.platform.retryTime);
            return;
        }

        let clusters = this.server.clusters;
        //choose a random MQ server within our zone
        let mqs = clusters.filter(v => v.instance_type == 5);
        this.mqCred = mqs[Math.floor(Math.random() * mqs.length)];
        let pubAddr = this.mqCred.public_addr;
        let privAddr = this.mqCred.private_addr;
        let parts = pubAddr.split(":");
        let host = parts[0];
        let port = parts[1];
        host = "amqp://" + this.credentials.platform.mqCluster.user + ":" + this.credentials.platform.mqCluster.pass + "@" + host + ":" + port;
        let mqOpts = {
            host
        }

        await this.mq.connect(mqOpts);

        this.mq.subscribe('ws', 'onRoomUpdate', this.onRoomUpdate.bind(this));
        this.mq.subscribe('ws', 'onJoinResponse', this.onJoinResponse.bind(this));
    }

    async connectToRedis(options) {
        if (!this.server || !this.server.clusters) {
            setTimeout(() => { this.connect(options) }, this.credentials.platform.retryTime);
            return;
        }

        let clusters = this.server.clusters;
        //choose a random Redis server within our zone
        let redises = clusters.filter(v => v.instance_type == 2);
        this.cluster = redises[Math.floor(Math.random() * redises.length)];
        let pubAddr = this.cluster.public_addr;
        let privAddr = this.cluster.private_addr;
        let parts = pubAddr.split(":");
        let host = parts[0];
        let port = parts[1];
        let redisOptions = {
            host, port
        }

        this.redis.connect(redisOptions);
    }


    onClientClose(ws, code, message) {
        console.log("Client Closed: ", ws.user.shortid, ws.user.displayname);
    }

    onClientOpen(ws) {
        if (!ws._logged) {
            console.log('unauthorized user: ', ws)
            ws.end()
            return
        }

        this.users[ws.user.shortid] = ws;
        ws.subscribe(ws.user.shortid);

        console.log("User connected: ", ws.user.shortid, ws.user.displayname);
    }




    async upgrade(res, req, context) {
        auth.upgrade(res, req, context, true);
    }

    verifyAPIKey(res, req) {
        let apikey = req.getHeader('x-api-key');
        if (apikey != '6C312A606D9A4CEBADB174F5FAE31A28') {
            res.end('Not valid');
            return false;
        }

        return true;
    }

    addPlayer(res, req) {
        if (!this.verifyAPIKey(res, req))
            return;
    }
    redirectPlayer(res, req) {
        if (!this.verifyAPIKey(res, req))
            return;
    }
    addGame(res, req) {
        if (!this.verifyAPIKey(res, req))
            return;
    }

    anyRoute(res, req) {
        console.log(req);
        let hookid = req.getHeader('x-github-hook-id');
        console.log("hookid", hookid);
        req.forEach((k, v) => {
            res.write('<li>');
            res.write(k);
            res.write(' = ');
            res.write(v);
            res.write('</li>');
        });
        res.end('</ul>');
    }

    onListen(listenSocket) {
        if (listenSocket) {
            console.log("Mem: ", process.memoryUsage())
            const used = process.memoryUsage().heapUsed / 1024 / 1024;
            console.log(`The script uses approximately ${Math.round(used * 100) / 100} MB`);
        }
        else {
            console.error("something wrong happened");
        }
    }
}

module.exports = new WSNode();