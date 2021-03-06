import type { PlatformAccessory } from 'homebridge';

export interface IDeviceDiscoveredProps {
    ipAddress: string;
    uniqueId: string;
    modelNumber: string;
}

export interface IDeviceQueriedProps {
    lightParameters: ILightParameters;
    controllerHardwareVersion: string;
    controllerFirmwareVersion: string;
}

export interface ILightParameters {
    controllerLogicType: string;
    convenientName: string;
    simultaneousCCT: boolean;
    hasColor:  boolean;
    hasBrightness: boolean;
}

export type IDeviceProps = IDeviceDiscoveredProps & IDeviceQueriedProps & {
    uuid: string;
    cachedIPAddress: string;
    displayName: string;
    restartsSinceSeen: number;
    lastKnownState;
}

export interface ILightState {
    isOn: boolean;
    RGB: IColorRGB;
    HSL?: IColorHSL;
    whiteValues:  IWhites;
    brightness?: number;
    colorTemperature?: number;
    debugBuffer?: Buffer;
    controllerHardwareVersion?: string;
    controllerFirmwareVersion?: string;
}

export interface IColorRGB {
    red: number; 
    green: number; 
    blue:number;
}

export interface IColorHSL {
    hue: number; 
    saturation: number; 
    luminance: number;
}

export interface IWhites {
    warmWhite: number; 
    coldWhite: number; 
}

export interface MagicHomeAccessory extends PlatformAccessory{
    context: {
      displayName: string;
      device: IDeviceProps
    }
  } 