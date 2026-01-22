declare module 'unzip-stream' {
  import { Transform } from 'node:stream'

  export interface ZipEntry extends Transform {
    path: string
    type: string
    autodrain: () => void
  }

  export function Parse(): Transform
  export function Extract(options: { path: string }): Transform

  const unzipStream: {
    Parse: typeof Parse
    Extract: typeof Extract
  }

  export default unzipStream
}
