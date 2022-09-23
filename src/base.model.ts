export abstract class BaseModel {
  abstract validate (): Promise<void>
}
