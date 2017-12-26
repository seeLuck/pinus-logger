import * as log4js from 'log4js';

import * as fs from 'fs';
import * as util from 'util';
import { Configuration, Levels } from 'log4js';


let funcs: {[key:string] : (name:string , opts:any) => string} = {
	'env': doEnv,
	'args': doArgs,
	'opts': doOpts
};

let styles = {
	//styles
	'bold': [1, 22],
	'italic': [3, 23],
	'underline': [4, 24],
	'inverse': [7, 27],
	//grayscale
	'white': [37, 39],
	'grey': [90, 39],
	'black': [90, 39],
	//colors
	'blue': [34, 39],
	'cyan': [36, 39],
	'green': [32, 39],
	'magenta': [35, 39],
	'red': [31, 39],
	'yellow': [33, 39]
};

let colours = {
	'all': "grey",
	'log': "grey",
	'trace': "blue",
	'debug': "cyan",
	'info': "green",
	'warn': "yellow",
	'error': "red",
	'fatal': "magenta",
	'off': "grey"
};

function getLogger(... args : string[])
{
	let categoryName = args[0];
	let prefix = "";
	for (let i = 1; i < args.length; i++)
	{
		if (i !== args.length - 1)
			prefix = prefix + args[i] + "] [";
		else
			prefix = prefix + args[i];
	}
	if (typeof categoryName === 'string')
	{
		// category name is __filename then cut the prefix path
		categoryName = categoryName.replace(process.cwd(), '');
	}
	let logger = log4js.getLogger(categoryName) as any;
	let pLogger : any = {};
	for (let key in logger)
	{
		pLogger[key] = logger[key];
	}

	['log', 'debug', 'info', 'warn', 'error', 'trace', 'fatal'].forEach((item : keyof typeof colours)=>
	{
		pLogger[item] = function ()
		{
			let p = "";
			if (!process.env.RAW_MESSAGE)
			{
				if (args.length > 1)
				{
					p = "[" + prefix + "] ";
				}
				if (args.length && process.env.LOGGER_LINE)
				{
					p = getLine() + ": " + p;
				}
				var a = colours[item];
				p = colorize(p, a as keyof typeof styles);
			}

			if (args.length)
			{
				arguments[0] = p + arguments[0];
			}
			logger[item].apply(logger, arguments);
		}
	});
	return pLogger as log4js.Logger;
};

let configState: { [key: string]: any } = {};

function initReloadConfiguration(filename: string, reloadSecs: number)
{
	if (configState.timerId)
	{
		clearInterval(configState.timerId);
		delete configState.timerId;
	}
	configState.filename = filename;
	configState.lastMTime = getMTime(filename);
	configState.timerId = setInterval(reloadConfiguration, reloadSecs * 1000);
};

function getMTime(filename: string)
{
	let mtime;
	try
	{
		mtime = fs.statSync(filename).mtime;
	} catch (e)
	{
		throw new Error("Cannot find file with given path: " + filename);
	}
	return mtime;
};

function loadConfigurationFile(filename: string)
{
	if (filename)
	{
		return JSON.parse(fs.readFileSync(filename, "utf8"));
	}
	return undefined;
};

function reloadConfiguration()
{
	let mtime = getMTime(configState.filename);
	if (!mtime)
	{
		return;
	}
	if (configState.lastMTime && (mtime.getTime() > configState.lastMTime.getTime()))
	{
		configureOnceOff(loadConfigurationFile(configState.filename));
	}
	configState.lastMTime = mtime;
};


function configureOnceOff(config : Config)
{
	if (config)
	{
		try
		{
			configureLevels(config.categories);
			if (config.replaceConsole)
			{
				const logger = log4js.getLogger('console');
				console.log = logger.info.bind(logger);
				console.warn = logger.warn.bind(logger);
				console.error = logger.error.bind(logger);
				console.trace = logger.trace.bind(logger);
			}
		} catch (e)
		{
			throw new Error(
				"Problem reading log4js config " + util.inspect(config) +
				". Error was \"" + e.message + "\" (" + e.stack + ")"
			);
		}
	}
};

function configureLevels(levels:  { [name: string]: { level: string; } })
{
	if (levels)
	{
		for (let category in levels)
		{
			if (levels.hasOwnProperty(category))
			{
				log4js.getLogger(category).level = levels[category].level;
			}
		}
	}
};

/**
 * Configure the logger.
 * Configure file just like log4js.json. And support ${scope:arg-name} format property setting.
 * It can replace the placeholder in runtime.
 * scope can be:
 *     env: environment variables, such as: env:PATH
 *     args: command line arguments, such as: args:1
 *     opts: key/value from opts argument of configure function
 *
 * @param  {String|Object} config configure file name or configure object
 * @param  {Object} opts   options
 * @return {Void}
 */
export type Config = Configuration & { lineDebug?: boolean, rawMessage?: boolean, reloadSecs?: number, replaceConsole ?: boolean };
function configure(configOrFilename: string | Config, opts: object)
{
	let filename = configOrFilename as string;
	configOrFilename = configOrFilename || process.env.LOG4JS_CONFIG;
	opts = opts || {};

	var config: Config;
	if (typeof configOrFilename === 'string')
	{
		config = JSON.parse(fs.readFileSync(configOrFilename, "utf8")) as Config;
	}
	else
	{
		config = configOrFilename;
	}

	if (config)
	{
		config = replaceProperties(config, opts);
	}

	if (config && config.lineDebug)
	{
		process.env.LOGGER_LINE = "true";
	}
	else
	{
		process.env.LOGGER_LINE = undefined;
	}

	if (config && config.rawMessage)
	{
		process.env.RAW_MESSAGE = "true";
	}

	if (filename && config && config.reloadSecs)
	{
		initReloadConfiguration(filename, config.reloadSecs);
	}

	// config object could not turn on the auto reload configure file in log4js

	log4js.configure(config);
};

function replaceProperties(configObj : any, opts: object)
{
	if (configObj instanceof Array)
	{
		for (let i = 0, l = configObj.length; i < l; i++)
		{
			configObj[i] = replaceProperties(configObj[i], opts);
		}
	} else if (typeof configObj === 'object')
	{
		let field;
		for (let f in configObj)
		{
			if (!configObj.hasOwnProperty(f))
			{
				continue;
			}

			field = configObj[f];
			if (typeof field === 'string')
			{
				configObj[f] = doReplace(field, opts);
			} else if (typeof field === 'object')
			{
				configObj[f] = replaceProperties(field, opts);
			}
		}
	}

	return configObj;
}

function doReplace(src: string, opts: object)
{
	if (!src)
	{
		return src;
	}

	let ptn = /\$\{(.*?)\}/g;
	let m, pro, ts, scope, name, defaultValue, func, res = '',
		lastIndex = 0;
	while ((m = ptn.exec(src)))
	{
		pro = m[1];
		ts = pro.split(':');
		if (ts.length !== 2 && ts.length !== 3)
		{
			res += pro;
			continue;
		}

		scope = ts[0];
		name = ts[1];
		if (ts.length === 3)
		{
			defaultValue = ts[2];
		}

		func = funcs[scope];
		if (!func && typeof func !== 'function')
		{
			res += pro;
			continue;
		}

		res += src.substring(lastIndex, m.index);
		lastIndex = ptn.lastIndex;
		res += (func(name, opts) || defaultValue);
	}

	if (lastIndex < src.length)
	{
		res += src.substring(lastIndex);
	}

	return res;
}

function doEnv(name: string, opts: any) : string
{
	return process.env[name];
}

function doArgs(name: string, opts: any) : string
{
	return process.argv[Number(name)];
}

function doOpts(name: string, opts: any) : string
{
	return opts ? opts[name] : undefined;
}

function getLine()
{
	let e = new Error();
	// now magic will happen: get line number from callstack
	if (process.platform === "win32")
	{
		return e.stack.split('\n')[3].split(':')[2];
	}
	return e.stack.split('\n')[3].split(':')[1];
}

function colorizeStart(style : keyof typeof styles)
{
	return style ? '\x1B[' + styles[style][0] + 'm' : '';
}

function colorizeEnd(style : keyof typeof styles)
{
	return style ? '\x1B[' + styles[style][1] + 'm' : '';
}
/**
 * Taken from masylum's fork (https://github.com/masylum/log4js-node)
 */
function colorize(str: string, style : keyof typeof styles)
{
	return colorizeStart(style) + str + colorizeEnd(style);
}

export
{
	getLogger,
	configure
};