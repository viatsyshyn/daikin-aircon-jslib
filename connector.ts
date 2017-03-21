import * as request from 'request';
import * as debug from 'debug';

const RET_MSG_OK = 'OK';
const RET_MSG_PARAM_NG = 'PARAM NG';
const RET_MSG_ADV_NG = 'ADV_NG';

const logger = {
    log: debug('daikin-aircon-jslib:debug'),
    info: debug('daikin-aircon-jslib:info'),
    error: debug('daikin-aircon-jslib:error'),
};

export const MODE = {
    AUTO: 0,
    DRY: 2,
    COOL: 3,
    HEAT: 4,
    FAN: 6,
};

export interface IGeneralInfo {
    name: string;
    mac: string;
    ver: string;
}

export interface IControlInfo {
    pow: boolean,
    stemp: number,
    mode: number,
    shum?: any,
    f_rate?: any,
    f_dir?: any
}

export interface ISensorInfo {
    htemp: number,
    otemp: number,
    hhum: number
}

export class Aircon {
    public constructor(private host: string) {}

    public reboot(): Promise {
        return this
            .send_request('GET', '/common/reboot');
    }

    public get_basic_info(): Promise<IGeneralInfo> {
        return this
            .send_request('GET', '/common/basic_info')
            .then(parse_basic_info);
    }

    public get_sensor_info(): Promise<ISensorInfo> {
        return this
            .send_request('GET', '/aircon/get_sensor_info')
            .then(parse_sensor_info);
    }

    public get_control_info(): Promise<IControlInfo> {
        return this.get_raw_control_info()
            .then(parse_control_info);
    }

    public set_control_info(params: IControlInfo): Promise {
        params = format_control_info(params);
        return this
            .get_raw_control_info()
            .then(current => {
                let minimal_state = {};
                ['pow', 'mode', 'stemp', 'shum', 'f_rate', 'f_dir']
                    .forEach(x => minimal_state[x] = current[x]);

                return Object.assign(minimal_state, params);
            })
            .then(params =>
                this.send_request('GET', '/aircon/set_control_info', params));
    }

    private get_raw_control_info(): Promise {
        return this.send_request('GET', '/aircon/get_control_info');
    }

    private send_request(method, url, params = null, headers = null): Promise {
        if (this.host == null || this.host === '')
            throw new Error('Host is required');

        if (method !== 'GET')
            throw new Error(`Target method ${method} is not implemented`);

        logger.log('REQUEST', method, url);

        return new Promise((resolve, reject) => {
                request.get({
                    uri: `http://${this.host}${url}`,
                    headers: headers,
                    qs: params
                }, (err, resp, data) => {
                    err ? reject(err): resolve(data);
                });
            })
            .then(response => {
                logger.log('REQUEST', method, url, response);

                /*
                 * Transform the air conditioner response into a dictionary
                 * If the response doesn't starts with standard prefix
                 * RESPONSE_PREFIX a Error will be raised.
                 */
                const rsp = response.split(',');
                if (rsp.length === 0 || rsp[0].indexOf('ret=') !== 0)
                    throw new Error("Unrecognized data format for the response");

                const ret_msg = rsp[0].substr(4);

                if (ret_msg === RET_MSG_PARAM_NG) {
                    throw new Error("Wrong parameters");
                } else if (ret_msg == RET_MSG_ADV_NG) {
                    throw new Error("Wrong ADV");
                } else if (ret_msg !== RET_MSG_OK) {
                    throw new Error(`Unrecognized return message: '${ret_msg}'`);
                }

                const r = {};
                rsp
                    // Remove the standard prefix
                    .slice(1)
                    // Transform the dictionary into a response
                    .map(s => s.split('=').map(decodeURIComponent))
                    .filter(x => x.length === 2)
                    .forEach(x => {
                        r[x[0]] = x[1];
                    });

                //logger.log('PROCESSED', r);

                return r;
            });
    }
}

const PARSER = {
    int: x => x == null ? 0 : parseInt(x, 10),
    temperature: x => x == null || x === '-' || x === '--' ? null : parseFloat(x),
    bool: x => x === 'true' || x === 1 || x === true,
    default: x => x
};

const FORMATTER = {
    int: x => '' + PARSER.int(x),
    temperature: x => '' + PARSER.temperature(x),
    bool: x => PARSER.bool(x) ? '1' : '0',
    default: x => x
};

function parse_data<T>(x, formats: Map<string, string[]>): T {
    Object.keys(formats).forEach(function (format) {
        const lambda = PARSER[format] || PARSER.default;
        formats[format].forEach(prop => x[prop] = lambda(x[prop]));
    });

    return x;
}

function format_data<T>(x: T, formats: Map<string, string[]>) {
    Object.keys(formats).forEach(function (format) {
        const lambda = FORMATTER[format] || FORMATTER.default;
        formats[format]
            .filter(prop => x[prop] != null)
            .forEach(prop => x[prop] = lambda(x[prop]));
    });

    return x;
}

function parse_basic_info(x): IGeneralInfo {
    const integers = ['port', 'err', 'pv'];
    const booleans = ['pow', 'led'];
    x['name'] = decodeURI(x['name']);
    return parse_data<IGeneralInfo>(x, {int: integers, bool: booleans});
}

function parse_sensor_info(x): ISensorInfo {
    const integers = ['err'];
    const temps = ['hhum', 'htemp', 'otemp'];
    return parse_data<ISensorInfo>(x, {int: integers, temperature: temps});
}

const ctrl_formats = {
    int: ['alert', 'mode', 'b_mode'],
    temperature: ['shum', 'stemp', 'b_shum'],
    bool: ['pow']
};

function parse_control_info(x): IControlInfo {
    return parse_data<IControlInfo>(x, ctrl_formats);
}

function format_control_info(x: IControlInfo) {
    return format_data<IControlInfo>(x, ctrl_formats);
}
