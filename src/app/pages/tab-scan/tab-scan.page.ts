import {
  IACHanderStatus,
  IACMessageTransport,
  PermissionsService,
  PermissionStatus,
  PermissionTypes,
  QrScannerService
} from '@airgap/angular-core'
import { Component, NgZone, ViewChild } from '@angular/core'
import { Platform } from '@ionic/angular'
import { ZXingScannerComponent } from '@zxing/ngx-scanner'
import { first } from 'rxjs/operators'
import { IACService } from 'src/app/services/iac/iac.service'

import { ErrorCategory, handleErrorLocal } from '../../services/error-handler/error-handler.service'

@Component({
  selector: 'airgap-tab-scan',
  templateUrl: './tab-scan.page.html',
  styleUrls: ['./tab-scan.page.scss']
})
export class TabScanPage {
  @ViewChild('scanner')
  public zxingScanner: ZXingScannerComponent
  public availableDevices: MediaDeviceInfo[]
  public selectedDevice: MediaDeviceInfo
  public scannerEnabled: boolean = true

  public isBrowser: boolean = false

  public hasCameras: boolean = false

  public hasCameraPermission: boolean | undefined = undefined

  public percentageScanned: number = 0
  public numberOfQrsScanned: number = 0
  public numberOfQrsTotal: number = 0

  public isMultiQr: boolean = false

  private parts: Set<string> = new Set()

  constructor(
    private readonly iacService: IACService,
    private readonly platform: Platform,
    private readonly scanner: QrScannerService,
    private readonly permissionsService: PermissionsService,
    private readonly ngZone: NgZone
  ) {
    this.isBrowser = !this.platform.is('hybrid')
  }

  public async ionViewWillEnter(): Promise<void> {
    if (this.platform.is('hybrid')) {
      await this.platform.ready()
      await this.checkCameraPermissionsAndActivate()
    }
    this.resetScannerPage()
  }

  private resetScannerPage(): void {
    this.parts = new Set()
    this.percentageScanned = 0
    this.isMultiQr = false
  }

  public async requestPermission(): Promise<void> {
    await this.permissionsService.userRequestsPermissions([PermissionTypes.CAMERA])
    await this.checkCameraPermissionsAndActivate()
  }

  public async checkCameraPermissionsAndActivate(): Promise<void> {
    const permission: PermissionStatus = await this.permissionsService.hasCameraPermission()
    if (permission === PermissionStatus.GRANTED) {
      this.hasCameraPermission = true
      this.startScan()
    } else {
      this.hasCameraPermission = false
    }
  }

  public ionViewDidEnter(): void {
    if (!this.platform.is('hybrid')) {
      this.hasCameraPermission = true
      this.zxingScanner.camerasNotFound.pipe(first()).subscribe((_devices: MediaDeviceInfo[]) => {
        console.error('An error has occurred when trying to enumerate your video-stream-enabled devices.')
      })
      if (this.selectedDevice) {
        // Not the first time that we open scanner
        this.zxingScanner.startScan(this.selectedDevice)
      }
      this.zxingScanner.camerasFound.pipe(first()).subscribe((devices: MediaDeviceInfo[]) => {
        this.hasCameras = true
        this.availableDevices = devices
        this.selectedDevice = devices[0]
      })
    }
  }

  public ionViewWillLeave(): void {
    if (this.platform.is('hybrid')) {
      this.scanner.destroy()
    } else {
      ;(this.zxingScanner as any).resetCodeReader()
    }
  }

  public startScan(): void {
    if (this.platform.is('hybrid')) {
      this.scanner.scan(
        (text: string) => {
          this.checkScan(text).catch(handleErrorLocal(ErrorCategory.SCHEME_ROUTING))
        },
        (error: string) => {
          console.warn(error)
          this.startScan()
        }
      )
    } else {
      // We don't need to do anything in the browser because it keeps scanning
    }
  }

  public async checkScan(data: string): Promise<boolean | void> {
    const sizeBefore: number = this.parts.size
    this.parts.add(data)

    if (sizeBefore === this.parts.size) {
      // We scanned a string we already have in our cache, ignoring it and starting scan again.
      console.log(`[SCAN:checkScan]: Already scanned string skipping ${data}`)
      this.startScan()

      return undefined
    }

    console.log(`[SCAN:checkScan]: Trying to decode string ${data}`)

    this.ngZone.run(() => {
      this.iacService
        .handleRequest(
          Array.from(this.parts),
          IACMessageTransport.QR_SCANNER,
          (scanResult?: Error | { currentPage: number; totalPageNumber: number }) => {
            console.log('scan result', scanResult)

            const typedScanResult = (scanResult as any) as { availablePages: number[]; totalPages: number }
            if (scanResult && typedScanResult.availablePages) {
              this.isMultiQr = true
              this.numberOfQrsScanned = typedScanResult.availablePages.length
              this.numberOfQrsTotal = typedScanResult.totalPages
              this.percentageScanned = Math.max(0, Math.min(1, typedScanResult.availablePages.length / typedScanResult.totalPages))
            }
            this.startScan()
          }
        )
        .then((result: IACHanderStatus) => {
          if (result === IACHanderStatus.SUCCESS) {
            this.resetScannerPage()
          }
        })
        .catch(handleErrorLocal(ErrorCategory.SCHEME_ROUTING))
    })
  }
}
