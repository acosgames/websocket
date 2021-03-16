const { v4: uuidv4 } = require('uuid');
const cookie = require('cookie')
const PersonService = require('fsg-shared/services/person');
const persons = new PersonService();

//use this class to implement a fancy authentication
class Authentication {
    constructor() {
        this.users = {};
        this.wss = null;
    }

    attach(WSServer) {
        this.wss = WSServer;
        this.wss.onUpgrade(this.onWSUpgrade);
        this.wss.onOpen(this.onWSOpen);
    }

    async check(res, req, context) {
        const _cookie = cookie.parse(req.getHeader('cookie'))
        console.log(_cookie);
        // validate the cookie somehow
        // and set _logged true or false

        try {
            req.forEach((k, v) => {
                console.log(k + "=" + v);
            });

            let user = { apikey: req.getHeader('sec-websocket-protocol') };
            user = await persons.findUser(user);

            return user;
        }
        catch (e) {
            console.error(e);
            // res.writeStatus('401')
        }
        return null;
    }

    onWSOpen(ws) {
        // disconnect if not logged
        if (!ws._logged) {
            ws.end()
            console.log('unauthorized', 'https://m.youtube.com/watch?v=OP30okjpCko')
            return
        }
    }


    generateAPIKey() {
        return uuidv4().replace(/\-/ig, '');
    }

    checkLogin(request, response, next) {

        if (!request.session.user) {
            //do login flow
            let passed = this.loginUser(request, response);
            if (!passed) {
                console.log("User is not authenticated");
                response.json({ error: "E_INVALID_AUTH" });
                return;
            }
        }
        else {
            let user = request.session.user;
            this.users[user.apikey] = user;
        }


        next();
    }

    //TODO: redirect user to login, must implement OIDC/Social login flow
    loginUser(request, response) {
        let session = request.session;
        let apikey = this.generateAPIKey();

        let sessionid = request.sessionID;
        let playerid = this.generateAPIKey().substr(24);

        let user = this.users[apikey] || {};
        user.apikey = apikey;
        user.playerid = playerid;
        user.sessionid = sessionid;

        this.users[apikey] = user;
        session.user = user;

        return true;
    }

    checkAPIKey(client, data) {
        if (!('X-API-KEY' in data)) {
            return false;
        }

        let apikey = data['X-API-KEY'];
        if (!(apikey in this.users)) {
            return false;
        }

        let user = this.users[apikey] || {};
        user.apikey = apikey;
        user.authenticated = true;
        user.clientid = client.id;
        this.users[apikey] = user;

        client.user = user;
        return true;
    }

    removeUser(user) {
        delete this.users[user.apikey];
    }
    getUserBySession(session) {
        return session.user;
    }
    getUserByClient(client) {
        return client.user;
    }
    getUser(apikey) {
        if (!(apikey in this.users))
            return null;
        return this.users[apikey];
    }
}

module.exports = new Authentication();