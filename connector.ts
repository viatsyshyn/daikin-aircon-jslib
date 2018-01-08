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

    public reboot(): Promise<void> {
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

    public set_control_info(params: IControlInfo): Promise<void> {
        params = format_control_info(params);
        return this
            .get_raw_control_info()
            .then((current: any) => {
                let minimal_state: any = {};
                ['pow', 'mode', 'stemp', 'shum', 'f_rate', 'f_dir']
                    .forEach(x => minimal_state[x] = current[x]);

                return (<any>Object).assign(minimal_state, params);
            })
            .then(params =>
                this.send_request('GET', '/aircon/set_control_info', params));
    }

    private get_raw_control_info(): Promise<void> {
        return this.send_request('GET', '/aircon/get_control_info');
    }

    private send_request<T = any>(method: string, url: string, params: any = null, headers: any = null): Promise<T> {
        if (this.host == null || this.host === '') {
            throw new Error('Host is required');
        }

        if (method !== 'GET') {
            throw new Error(`Target method ${method} is not implemented`);
        }

        logger.log('REQUEST', method, url, params);

        return new Promise((resolve, reject) => {
                request.get({
                    uri: `http://${this.host}${url}`,
                    headers: headers,
                    qs: params
                }, (err: any, resp: any, data: string) => {
                    err ? reject(err): resolve(data);
                });
            })
            .then((response: string) => {
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

                const r: any = {};
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

                return r as T;
            });
    }
}

const PARSER = {
    int: (x: null | string | number) => x == null ? 0 : parseInt(''+x, 10),
    temperature: (x: null | string) => x == null || x === '-' || x === '--' ? null : parseFloat(x),
    bool: (x: null | string | number | boolean)  => x === 'true' || x === 1 || x === true,
    default: (x: any)  => x
};

const FORMATTER = {
    int: (x: number) => '' + PARSER.int(x),
    temperature: (x: string) => '' + PARSER.temperature(x),
    bool: (x: boolean) => PARSER.bool(x) ? '1' : '0',
    default: (x: any) => x
};

type Format = 'int' | 'temperature' | 'bool' | 'default';

function parse_data<T>(x: any, formats: any): T {
    Object.keys(formats).forEach((format: Format) => {
        const lambda = PARSER[format] || PARSER.default;
        formats[format].forEach((prop: string) => x[prop] = lambda(x[prop]));
    });

    return x as T;
}

function format_data<T>(x: any, formats: any) {
    Object.keys(formats).forEach((format: Format) => {
        const lambda = FORMATTER[format] || FORMATTER.default;
        formats[format]
            .filter((prop: string) => x[prop] != null)
            .forEach((prop: string) => x[prop] = lambda(x[prop]));
    });

    return x as T;
}

function parse_basic_info(x: any): IGeneralInfo {
    const integers = ['port', 'err', 'pv'];
    const booleans = ['pow', 'led'];
    x['name'] = decodeURI(x['name']);
    return parse_data<IGeneralInfo>(x, {int: integers, bool: booleans});
}

function parse_sensor_info(x: any): ISensorInfo {
    const integers = ['err'];
    const temps = ['hhum', 'htemp', 'otemp'];
    return parse_data<ISensorInfo>(x, {int: integers, temperature: temps});
}

const ctrl_formats = {
    int: ['alert', 'mode', 'b_mode'],
    temperature: ['shum', 'stemp', 'b_shum'],
    bool: ['pow']
};

function parse_control_info(x: any): IControlInfo {
    return parse_data<IControlInfo>(x, ctrl_formats);
}

function format_control_info(x: IControlInfo): IControlInfo {
    return format_data<IControlInfo>(x, ctrl_formats);
}
