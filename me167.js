const fz = require('zigbee-herdsman-converters/converters/fromZigbee');
const tz = require('zigbee-herdsman-converters/converters/toZigbee');
const exposes = require('zigbee-herdsman-converters/lib/exposes');
const reporting = require('zigbee-herdsman-converters/lib/reporting');
const extend = require('zigbee-herdsman-converters/lib/extend');
const e = exposes.presets;
const ea = exposes.access;
const tuya = require("zigbee-herdsman-converters/lib/tuya");

const tuyaLocal = {
  dataPoints: {
    me167Mode: 2,
    me167HeatingSetpoint: 4,
    me167LocalTemp: 5,
    me167ChildLock: 7,
    me167Heating: 3,
    me167Schedule1: 28,
    me167Schedule2: 29,
    me167Schedule3: 30,
    me167Schedule4: 31,
    me167Schedule5: 32,
    me167Schedule6: 33,
    me167Schedule7: 34,
    me167ErrorCode: 35,
    me167FrostGuard: 36,
    me167AntiScaling: 39,
    me167TempCalibration: 47,
  },
};

const fzLocal = {
  me167_thermostat: {
    cluster: 'manuSpecificTuya',
    type: ['commandDataResponse', 'commandDataReport'],
    convert: (model, msg, publish, options, meta) => {
        const result = {};

        function weeklySchedule(day, value) {
          // byte 0 - Day of Week (0~7 = Wed ~ Tue) ???
          // byte 1 - hour ???
          // byte 2 - minute ???
          // byte 3 - Temp (temp = value )
          // byte 4 - Temperature (temp = value / 10)

          const weekDays=[ 'wed', 'thu', 'fri', 'sat', 'sun','mon', 'tue'];
          // we get supplied in value only a weekday schedule, so we must add it to
          // the weekly schedule from meta.state, if it exists
          const weeklySchedule= meta.state.hasOwnProperty('weekly_schedule') ? meta.state.weekly_schedule : {};
          meta.logger.info(JSON.stringify({'received day': day, 'received values': value}));
          let daySchedule = []; // result array
          for (let i=1; i<16 && value[i]; ++i) {
            const aHour=value[i];
            ++i;
            const aMinute=value[i];
            ++i;
            const aTemp2=value[i];
            ++i;
            const aTemp=value[i];
            daySchedule=[...daySchedule, {
              temperature: Math.floor((aTemp+aTemp2*256)/10),
              hour: aHour,
              minute: aMinute,
            }];
          }
          meta.logger.info(JSON.stringify({'returned weekly schedule: ': daySchedule}));
          return {'weekly-schedule': {...weeklySchedule, [weekDays[day]]: daySchedule}};
        }


        for (const dpValue of msg.data.dpValues) {
            const value = tuya.getDataValue(dpValue);

            switch (dpValue.dp) {
            case tuyaLocal.dataPoints.me167ChildLock:
                result.child_lock = value ? 'LOCK' : 'UNLOCK';
                break;
            case tuyaLocal.dataPoints.me167HeatingSetpoint:
                result.current_heating_setpoint = value/10;
                break;
            case tuyaLocal.dataPoints.me167LocalTemp:
                result.local_temperature = value/10;
                break;
            case tuyaLocal.dataPoints.me167Heating:
                switch(value) {
                  case 0:
                    result.heating = "ON"; // valve open
                    break;
                  case 1:
                    result.heating = "OFF"; // valve closed
                    break;
                  default:
                    meta.logger.warn('zigbee-herdsman-converters:me167_thermostat: ' +
                      `Heating ${value} is not recognized.`);
                    break;
                }
                break;
            case tuyaLocal.dataPoints.me167Mode:
                switch (value) {
                case 0: // auto
                    result.system_mode = 'auto';
                    break;
                case 1: // manu
                    result.system_mode = 'heat';
                    break;
                case 2: // off
                    result.system_mode = 'off';
                    break;
                default:
                    meta.logger.warn('zigbee-herdsman-converters:me167_thermostat: ' +
                      `Mode ${value} is not recognized.`);
                    break;
                }
                break;
              case tuyaLocal.dataPoints.me167Schedule1:
                weeklySchedule(0,value);
                break;
              case tuyaLocal.dataPoints.me167Schedule2:
                weeklySchedule(1,value);
                break;
              case tuyaLocal.dataPoints.me167Schedule3:
                weeklySchedule(2,value);
                break;
              case tuyaLocal.dataPoints.me167Schedule4:
                weeklySchedule(3,value);
                break;
              case tuyaLocal.dataPoints.me167Schedule5:
                weeklySchedule(4,value);
                break;
              case tuyaLocal.dataPoints.me167Schedule6:
                weeklySchedule(5,value);
                break;
              case tuyaLocal.dataPoints.me167Schedule7:
                weeklySchedule(6,value);
                break;
              case tuyaLocal.dataPoints.me167TempCalibration:
                if (value > 4000000000 ){
                  result.local_temperature_calibration = (value-4294967295)-1 // negative values
                }else{
                  result.local_temperature_calibration = value
                }
                break;
              case tuyaLocal.dataPoints.me167ErrorCode:
                switch (value) {
                  case 0: // OK
                      result.battery_low = false;
                      meta.logger.info(`zigbee-herdsman-converters:me167_thermostat: BattOK - Error Code: ` +
                    `${JSON.stringify(dpValue)}`);
                      break;
                  case 1: // Empty Battery
                      result.battery_low = true;
                      meta.logger.info(`zigbee-herdsman-converters:me167_thermostat: BattEmtpy - Error Code: ` +
                    `${JSON.stringify(dpValue)}`);
                      break;
                  default:
                      meta.logger.info(`zigbee-herdsman-converters:me167_thermostat: Error Code not recognized: ` +
                    `${JSON.stringify(dpValue)}`);
                      break;
                  }
                break; 
              case tuyaLocal.dataPoints.me167FrostGuard:
                result.frost_guard = value ? 'ON' : 'OFF';
                break;
              case tuyaLocal.dataPoints.me167AntiScaling:
                result.anti_scaling = value ? 'ON' : 'OFF';
                break;

            default:
                meta.logger.warn(`zigbee-herdsman-converters:me167_thermostat: NOT RECOGNIZED ` +
                  `DP #${dpValue.dp} with data ${JSON.stringify(dpValue)}`);
            }
        }
        return result;
    },
  },
};

const tzLocal = {
  me167_thermostat_current_heating_setpoint: {
      key: ['current_heating_setpoint'],
      convertSet: async (entity, key, value, meta) => {
          const temp = Math.round(value * 10);
          await tuya.sendDataPointValue(entity, tuyaLocal.dataPoints.me167HeatingSetpoint, temp);
      },
  },
  me167_thermostat_system_mode: {
      key: ['system_mode'],
      convertSet: async (entity, key, value, meta) => {
          switch (value) {
          case 'off':
              await tuya.sendDataPointEnum(entity, tuyaLocal.dataPoints.me167Mode, 2 /* off */);
              break;
          case 'heat':
              await tuya.sendDataPointEnum(entity, tuyaLocal.dataPoints.me167Mode, 1 /* manual */);
              break;
          case 'auto':
              await tuya.sendDataPointEnum(entity, tuyaLocal.dataPoints.me167Mode, 0 /* auto */);
              break;
          }
      },
  },
  me167_thermostat_child_lock: {
      key: ['child_lock'],
      convertSet: async (entity, key, value, meta) => {
          await tuya.sendDataPointBool(entity, tuyaLocal.dataPoints.me167ChildLock, value === 'LOCK');
      },
    },

  me167_thermostat_schedule: {
    key: ['weekly_schedule'],
    convertSet: async (entity, key, value, meta) => {
      const weekDays=['wed', 'thu', 'fri', 'sat', 'sun', 'mon' , 'tue'];
      // we overwirte only the received days. The other ones keep stored on the device
      const keys = Object.keys(value);
      for (const dayName of keys) { // for loop in order to delete the empty day schedules
        const output= []; // empty output byte buffer
        const dayNo=weekDays.indexOf(dayName);
        output[0]=dayNo+1;
        const schedule=value[dayName];
        schedule.forEach((el, Index) => {
          if (Index <4) {
            output[1+4*Index]=el.hour;
            output[2+4*Index]=el.minute;
            output[3+4*Index]=Math.floor((el.temperature*10)/256);
            output[4+4*Index]=(el.temperature*10)%256;
          } else {
            meta.logger.warn('more than 4 schedule points supplied for week-day '+dayName +
            ' additional schedule points will be ignored');
          }
        });
        meta.logger.info(`zigbee-herdsman-converters:me167_thermostat: Writing Schedule to ` +
                  `DP #${tuyaLocal.dataPoints.me167Schedule1+dayNo} with data ${JSON.stringify(output)}`);
        await tuya.sendDataPointRaw(entity, tuyaLocal.dataPoints.me167Schedule1+dayNo, output);
        await new Promise((r) => setTimeout(r, 2000));
        // wait 2 seconds between schedule sends in order not to overload the device
      }
    },
  },
  me167_thermostat_calibration: {
    key: ['local_temperature_calibration'],
    convertSet: async (entity, key, value, meta) => {
      if (value >= 0) value = value;
      if (value < 0) value = value+4294967295+1;
      await tuya.sendDataPointValue(entity, tuyaLocal.dataPoints.me167TempCalibration, value);
    },
  },
  me167_thermostat_anti_scaling: {
    key: ['anti_scaling'],
    convertSet: async (entity, key, value, meta) => {
      await tuya.sendDataPointValue(entity, tuyaLocal.dataPoints.me167AntiScaling, value);
    },
  },
  me167_thermostat_frost_guard: {
    key: ['frost_guard'],
    convertSet: async (entity, key, value, meta) => {
      await tuya.sendDataPointValue(entity, tuyaLocal.dataPoints.me167FrostGuard, value);
    },
  },
};

const definition = {
    // Since a lot of Tuya devices use the same modelID, but use different data points
    // it's usually necessary to provide a fingerprint instead of a zigbeeModel
    fingerprint: [
        {
            // The model ID from: Device with modelID 'TS0601' is not supported
            // You may need to add \u0000 at the end of the name in some cases
            modelID: 'TS0601',
            // The manufacturer name from: Device with modelID 'TS0601' is not supported.
            manufacturerName: '_TZE200_bvu2wnxz'
        },
    ],
    model: 'ME167',
    vendor: 'Avatto',
    description: 'Thermostatic radiator valve',
    fromZigbee: [
        fz.ignore_basic_report, // Add this if you are getting no converter for 'genBasic'
        //fz.tuya_data_point_dump, // This is a debug converter, it will be described in the next part
        fzLocal.me167_thermostat,
    ],
    toZigbee: [
        //tz.tuya_data_point_test, // Another debug converter
        tzLocal.me167_thermostat_child_lock,
        tzLocal.me167_thermostat_current_heating_setpoint,
        tzLocal.me167_thermostat_system_mode,
        tzLocal.me167_thermostat_schedule,
        tzLocal.me167_thermostat_calibration,
        tzLocal.me167_thermostat_anti_scaling,
        tzLocal.me167_thermostat_frost_guard,
    ],
    onEvent: tuya.onEventSetTime, // Add this if you are getting no converter for 'commandMcuSyncTime'
    configure: async (device, coordinatorEndpoint, logger) => {
        const endpoint = device.getEndpoint(1);
        await reporting.bind(endpoint, coordinatorEndpoint, ['genBasic']);
    },
    exposes: [
      e.child_lock(),
      exposes.binary('heating', ea.STATE, 'ON', 'OFF').withDescription('Device valve is open or closed (heating or not)'),
      exposes.switch().withState('anti_scaling', true).withDescription('Anti Scaling feature is ON or OFF'),
      exposes.switch().withState('frost_guard', true).withDescription('Frost Protection feature is ON or OFF'),
      exposes.climate().withSetpoint('current_heating_setpoint', 5, 35, 1)
                     .withLocalTemperature()
                     .withSystemMode(['auto','heat','off'])
                     .withLocalTemperatureCalibration(-3, 3, 1, ea.STATE_SET)
    ],
};

module.exports = definition;
