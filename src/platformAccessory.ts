import { CharacteristicEventTypes } from 'homebridge';
import type {
  Service, PlatformConfig, PlatformAccessory, CharacteristicValue,
  CharacteristicSetCallback, CharacteristicGetCallback,
} from 'homebridge';
import { clamp, convertHSLtoRGB, convertRGBtoHSL } from './magichome-interface/utils';
import { HomebridgeMagichomeDynamicPlatform } from './platform';
import { Transport } from './magichome-interface/Transport';
import { getLogger } from './instance';
import { MagicHomeAccessory, IDeviceProps } from './magichome-interface/types';

const COMMAND_POWER_ON = [0x71, 0x23, 0x0f];
const COMMAND_POWER_OFF = [0x71, 0x24, 0x0f];
const animations = {
  none: { name: 'none', brightnessInterrupt: true, hueSaturationInterrupt: true },
};


const INTRA_MESSAGE_TIME = 20; 
/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class HomebridgeMagichomeDynamicPlatformAccessory {
  protected service: Service;
  protected myDevice: IDeviceProps = this.accessory.context.device;
  protected transport = new Transport(this.myDevice.cachedIPAddress, this.config);
  protected colorWhiteThreshold = this.config.whiteEffects.colorWhiteThreshold;
  protected colorWhiteThresholdSimultaniousDevices = this.config.whiteEffects.colorWhiteThresholdSimultaniousDevices;
  protected colorOffThresholdSimultaniousDevices = this.config.whiteEffects.colorOffThresholdSimultaniousDevices;
  protected simultaniousDevicesColorWhite = this.config.whiteEffects.simultaniousDevicesColorWhite;

  //protected interval;
  public activeAnimation = animations.none;

  protected colorCommand = false;
  protected deviceWriteInProgress = false;
  protected deviceWriteRetry: any = null;
  protected deviceUpdateInProgress = false;
  log = getLogger();
  public lightStateTemporary= {
    HSL: { hue: 255, saturation: 100, luminance: 50 },
    RGB: { red: 0, green: 0, blue: 0 },
    whiteValues: {warmWhite: 0, coldWhite: 0},
    isOn: true,
    brightness: 100,
  };

  protected lightState = {
    HSL: { hue: 255, saturation: 100, luminance: 50 },
    RGB: { red: 0, green: 0, blue: 0 },
    whiteValues: {warmWhite: 0, coldWhite: 0},
    isOn: true,
    brightness: 100,
  }

  //=================================================
  // Start Constructor //

  constructor(
    protected readonly platform: HomebridgeMagichomeDynamicPlatform,
    protected readonly accessory: MagicHomeAccessory,
    public readonly config: PlatformConfig,
  ) {

    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Magic Home')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.myDevice.uniqueId)
      .setCharacteristic(this.platform.Characteristic.Model, this.myDevice.modelNumber)
      .setCharacteristic(this.platform.Characteristic.FirmwareRevision, this.myDevice.controllerFirmwareVersion) //?
      .getCharacteristic(this.platform.Characteristic.Identify)
      .on(CharacteristicEventTypes.SET, this.identifyLight.bind(this));       // SET - bind to the 'Identify` method below

    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .addOptionalCharacteristic(this.platform.Characteristic.ConfiguredName);


    // get the LightBulb service if it exists, otherwise create a new LightBulb service
    // you can create multiple services for each accessory
    if(this.myDevice.lightParameters.hasBrightness || this.myDevice.lightParameters.hasBrightness == undefined){
            
      if (this.accessory.getService(this.platform.Service.Switch)) {
        this.accessory.removeService(this.accessory.getService(this.platform.Service.Switch));
      }
      this.service = this.accessory.getService(this.platform.Service.Lightbulb) ?? this.accessory.addService(this.platform.Service.Lightbulb);
      this.myDevice.lightParameters.hasBrightness = true;

      this.service.getCharacteristic(this.platform.Characteristic.ConfiguredName)
        .on(CharacteristicEventTypes.SET, this.setConfiguredName.bind(this));
    
      // each service must implement at-minimum the "required characteristics" for the given service type
      // see https://developers.homebridge.io/#/service/Lightbulb

      // register handlers for the Brightness Characteristic
      this.service.getCharacteristic(this.platform.Characteristic.Brightness)
        .on(CharacteristicEventTypes.SET, this.setBrightness.bind(this))        // SET - bind to the 'setBrightness` method below
        .on(CharacteristicEventTypes.GET, this.getBrightness.bind(this));       // GET - bind to the 'getBrightness` method below

      if( this.myDevice.lightParameters.hasColor){
        // register handlers for the Hue Characteristic
        this.service.getCharacteristic(this.platform.Characteristic.Hue)
          .on(CharacteristicEventTypes.SET, this.setHue.bind(this))               // SET - bind to the 'setHue` method below
          .on(CharacteristicEventTypes.GET, this.getHue.bind(this));              // GET - bind to the 'getHue` method below

        // register handlers for the Saturation Characteristic
        this.service.getCharacteristic(this.platform.Characteristic.Saturation)
          .on(CharacteristicEventTypes.SET, this.setSaturation.bind(this));        // SET - bind to the 'setSaturation` method below
        //.on(CharacteristicEventTypes.GET, this.getSaturation.bind(this));       // GET - bind to the 'getSaturation` method below
        // register handlers for the On/Off Characteristic
      

      }
    } else {

      this.service = this.accessory.getService(this.platform.Service.Switch) ?? this.accessory.addService(this.platform.Service.Switch);
      this.service.getCharacteristic(this.platform.Characteristic.ConfiguredName)
        .on(CharacteristicEventTypes.SET, this.setConfiguredName.bind(this));

    }
    // register handlers for the On/Off Characteristic
    this.service.getCharacteristic(this.platform.Characteristic.On)
      .on(CharacteristicEventTypes.SET, this.setOn.bind(this))              // SET - bind to the `setOn` method below
      .on(CharacteristicEventTypes.GET, this.getOn.bind(this));               // GET - bind to the `getOn` method below
    //this.service2.updateCharacteristic(this.platform.Characteristic.On, false);
    this.updateLocalState();
    // set the service name, this is what is displayed as the default name on the Home app
    // in this example we are using the name we stored in the `accessory.context` in the `discoverDevices` method.
    this.service.setCharacteristic(this.platform.Characteristic.Name,  this.myDevice.displayName);
  

  }

  //=================================================
  // End Constructor //

  //=================================================
  // Start Setters //

  setConfiguredName(value: CharacteristicValue, callback: CharacteristicSetCallback) {
    const name: string = value.toString();
    this.platform.log.debug('Renaming device to %o', name);
    this.myDevice.displayName = name;
    this.platform.api.updatePlatformAccessories([this.accessory]);

    callback(null);
  }

  identifyLight() {
    this.platform.log.info('Identifying accessory: %o!', this.myDevice.displayName);
    this.flashEffect();

  }

  setHue(value: CharacteristicValue, callback: CharacteristicSetCallback) {
    this.lightState.HSL.hue = value as number; 
    this.colorCommand = true;
    this.processRequest();
    callback(null);
  }

  setSaturation(value: CharacteristicValue, callback: CharacteristicSetCallback) {
    this.lightState.HSL.saturation = value as number; 
    this.colorCommand = true;
    this.processRequest();
    callback(null);
  }

  setBrightness(value: CharacteristicValue, callback: CharacteristicSetCallback) {
    this.lightState.brightness = value as number; 
    this.colorCommand = true;
    this.processRequest();
    callback(null);
  }

  /*
  async setColorTemperature(value: CharacteristicValue, callback: CharacteristicSetCallback){
    this.lightState.operatingMode = opMode.temperatureMode;
    this.processRequest({msg: `cct=${value}`} );
    callback(null);
  }*/

  setOn(value: CharacteristicValue, callback: CharacteristicSetCallback) {
    
    this.lightState.isOn = value as boolean;
    this.processRequest();
    callback(null);
  }

  //=================================================
  // End Setters //

  //=================================================
  // Start Getters //

  getHue(callback: CharacteristicGetCallback) {

    const hue = this.lightState.HSL.hue;

    //update state with actual values asynchronously
    this.platform.log.debug('Get Characteristic Hue -> %o for device: %o ', hue, this.myDevice.displayName);
    this.updateLocalState();

    callback(null, hue);
  }

  getBrightness(callback: CharacteristicGetCallback) {

    // implement your own code to check if the device is on
    const brightness = this.lightState.brightness;

    // dont update the actual values from brightness, it is impossible to determine by rgb values alone
    //this.getState();

    this.platform.log.debug('Get Characteristic Brightness -> %o for device: %o ', brightness, this.myDevice.displayName);
    this.updateLocalState();

    callback(null, brightness);
  }

  /**
   ** @getOn
   * instantly retrieve the current on/off state stored in our object
   * next call this.getState() which will update all values asynchronously as they are ready
   */
  getOn(callback: CharacteristicGetCallback) {

    const isOn = this.lightState.isOn;

    //update state with actual values asynchronously
    this.updateLocalState();

    this.platform.log.debug('Get Characteristic On -> %o for device: %o ', isOn, this.myDevice.displayName);
    callback(null, isOn);
  }

  //=================================================
  // End Getters //

  //=================================================
  // Start State Get/Set //


  /**
   ** @updateLocalState
   * retrieve light's state object from transport class
   * once values are available, update homekit with actual values
   */
  async updateLocalState() {

    try {
      let state;
      let scans = 0;
      while(state == null && scans <= 5){
        state = await this.transport.getState(1000); //retrieve a state object from transport class showing light's current r,g,b,ww,cw, etc
        scans++;
      } 
      if(state == null){
        const { ipAddress, uniqueId, displayName } = this.myDevice;
        this.platform.log.debug(`No response from device '${displayName}' (${uniqueId}) ${ipAddress}`); 
        return;
      }
      this.myDevice.lastKnownState = state;
      this.updateLocalRGB(state.RGB);
      this.updateLocalHSL(convertRGBtoHSL(this.lightState.RGB));
      this.updateLocalWhiteValues(state.whiteValues);
      this.updateLocalIsOn(state.isOn);
      this.updateHomekitState();

    } catch (error) {
      this.platform.log.error('getState() error: ', error);
    }
  }

  /**
   ** @updateHomekitState
   * send state to homekit
   */
  async updateHomekitState() {

    this.service.updateCharacteristic(this.platform.Characteristic.On,  this.lightState.isOn);
    this.service.updateCharacteristic(this.platform.Characteristic.Hue, this.lightState.HSL.hue);
    this.service.updateCharacteristic(this.platform.Characteristic.Saturation, this.lightState.HSL.saturation);
    if(this.lightState.HSL.luminance > 0 && this.lightState.isOn){
      this.updateLocalBrightness(this.lightState.HSL.luminance * 2);
    }
    this.service.updateCharacteristic(this.platform.Characteristic.Brightness,  this.lightState.brightness);
  }

  updateLocalHSL(_hsl){
    this.lightState.HSL = _hsl;
  }

  updateLocalRGB(_rgb){
    this.lightState.RGB = _rgb;
  }

  updateLocalWhiteValues(_whiteValues){
    this.lightState.whiteValues = _whiteValues;
  }

  updateLocalIsOn(_isOn){
    this.lightState.isOn = _isOn;
  }

  updateLocalBrightness(_brightness){
    this.lightState.brightness = _brightness;
  }


  /**
   ** @updateDeviceState
   *  determine RGB and warmWhite/coldWhite values  from homekit's HSL
   *  perform different logic based on light's capabilities, detimined by "this.myDevice.lightVersion"
   *  
   */
  async updateDeviceState(_timeout = 200) {

    //**** local variables ****\\
    const hsl = this.lightState.HSL;
    const [red, green, blue] = convertHSLtoRGB(hsl); //convert HSL to RGB
    const brightness = this.lightState.brightness;
    /*
    this.platform.log.debug('Current HSL and Brightness: h:%o s:%o l:%o br:%o', hsl.hue, hsl.saturation, hsl.luminance, brightness);
    this.platform.log.debug('Converted RGB: r:%o g:%o b:%o', red, green, blue);
    */
    const mask = 0xF0; // the 'mask' byte tells the controller which LEDs to turn on color(0xF0), white (0x0F), or both (0xFF)
    //we default the mask to turn on color. Other values can still be set, they just wont turn on
    
    //sanitize our color/white values with Math.round and clamp between 0 and 255, not sure if either is needed
    //next determine brightness by dividing by 100 and multiplying it back in as brightness (0-100)
    const r = Math.round(((clamp(red, 0, 255) / 100) * brightness));
    const g = Math.round(((clamp(green, 0, 255) / 100) * brightness));
    const b = Math.round(((clamp(blue, 0, 255) / 100) * brightness));

    this.send([0x31, r, g, b, 0x00, mask, 0x0F], true, _timeout); //8th byte checksum calculated later in send()
  


  }//updateDeviceState

  //=================================================
  // End State Get/Set //

  //=================================================
  // Start Misc Tools //


  /**
   ** @calculateWhiteColor
   *  determine warmWhite/coldWhite values from hue
   *  the closer to 0/360 the weaker coldWhite brightness becomes
   *  the closer to 180 the weaker warmWhite brightness becomes
   *  the closer to 90/270 the stronger both warmWhite and coldWhite become simultaniously
   */
  hueToWhiteTemperature() {
    const hsl = this.lightState.HSL;
    let multiplier = 0;
    const whiteTemperature = { warmWhite: 0, coldWhite: 0 };


    if (hsl.hue <= 90) {        //if hue is <= 90, warmWhite value is full and we determine the coldWhite value based on Hue
      whiteTemperature.warmWhite = 255;
      multiplier = ((hsl.hue / 90));
      whiteTemperature.coldWhite = Math.round((255 * multiplier));
    } else if (hsl.hue > 270) { //if hue is >270, warmWhite value is full and we determine the coldWhite value based on Hue
      whiteTemperature.warmWhite = 255;
      multiplier = (1 - (hsl.hue - 270) / 90);
      whiteTemperature.coldWhite = Math.round((255 * multiplier));
    } else if (hsl.hue > 180 && hsl.hue <= 270) { //if hue is > 180 and <= 270, coldWhite value is full and we determine the warmWhite value based on Hue
      whiteTemperature.coldWhite = 255;
      multiplier = ((hsl.hue - 180) / 90);
      whiteTemperature.warmWhite = Math.round((255 * multiplier));
    } else if (hsl.hue > 90 && hsl.hue <= 180) {//if hue is > 90 and <= 180, coldWhite value is full and we determine the warmWhite value based on Hue
      whiteTemperature.coldWhite = 255;
      multiplier = (1 - (hsl.hue - 90) / 90);
      whiteTemperature.warmWhite = Math.round((255 * multiplier));
    }
    return whiteTemperature;
  } //hueToWhiteTemperature

  


  async send(command: number[], useChecksum = true, _timeout = 200) {
    const buffer = Buffer.from(command);

    const output = await this.transport.send(buffer, useChecksum, _timeout);
    //this.platform.log.debug('Recieved the following response', output);

  } //send

  cacheCurrentLightState(){
    this.lightStateTemporary.HSL = this.lightState.HSL;
  }

  async restoreCachedLightState(){
    this.lightState.HSL = this.lightStateTemporary.HSL;
    this.updateDeviceState();
  }
  //=================================================
  // End Misc Tools //


  //=================================================
  // Start LightEffects //

  flashEffect() {
    this.lightState.HSL.hue = 100 as number;
    this.lightState.HSL.saturation = 100 as number;

    let change = true;
    let count = 0;

    const interval = setInterval(() => {

      if (change) {
        this.lightState.brightness = 0;

      } else {
        this.lightState.brightness = 100;
      }

      change = !change;
      count++;
      this.updateDeviceState();

      if (count >= 20) {

        this.lightState.HSL.hue = 0;
        this.lightState.HSL.saturation = 5;
        this.lightState.brightness = 100;
        this.updateDeviceState();
        clearInterval(interval);
        return;
      }
    }, 300);
  } //flashEffect
  
  async stopAnimation(){
    this.activeAnimation = animations.none;
    // this.service2.updateCharacteristic(this.platform.Characteristic.On, false);
    //clearInterval(this.interval);
  }

  //=================================================
  // End LightEffects //

  protected myTimer = null
  protected timestamps = []

  protected timeOfLastRead = null; 
  protected timeOfLastWrite = null; 



  processRequest(){
    if(!this.deviceUpdateInProgress){
      this.deviceUpdateInProgress = true;
      setTimeout(  () =>  {
        if (( !this.colorCommand) || !this.lightState.isOn){ //if no color command or a command to turn the light off
          this.send(this.lightState.isOn ? COMMAND_POWER_ON : COMMAND_POWER_OFF); // set the power
        } else {
          
          this.updateDeviceState(); // set color
        }
        this.colorCommand = false;
        this.deviceUpdateInProgress = false;
      }, INTRA_MESSAGE_TIME);
    }
    return;
  }
} // ZackneticMagichomePlatformAccessory class

