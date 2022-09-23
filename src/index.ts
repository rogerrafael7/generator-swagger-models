import * as path from 'path'
import * as fs from 'fs/promises'
import * as fsOld from 'fs'
import { spawn } from 'child_process'

const [
  , ,
  swaggerFilePath,
  modelsDir = 'models',
  prefixModelsName = ''
] = process.argv

const pathModels = path.resolve(process.cwd(), modelsDir)
if (!fsOld.existsSync(pathModels)) {
  fsOld.mkdirSync(pathModels)
}

// clearn models dir
const cleanModelsDir = async () => {
  const files = await fs.readdir(pathModels)
  for (const file of files) {
    const pathFile = path.resolve(pathModels, file)
    await fs.unlink(pathFile)
  }
}

// copy base model and base exception to models dir
const copyBaseModel = async () => {
  const pathBaseModel = path.resolve(__dirname, 'base.model.ts')
  const pathBaseException = path.resolve(__dirname, 'base.exception.ts')
  const pathBaseModelDest = path.resolve(pathModels, 'base.model.ts')
  const pathBaseExceptionDest = path.resolve(pathModels, 'base.exception.ts')
  await fs.copyFile(pathBaseModel, pathBaseModelDest)
  await fs.copyFile(pathBaseException, pathBaseExceptionDest)
}

const toKebabCase = (str: string) => {
  return str.replace(/(.)([A-Z])/g, (_f, a, b) => {
    return `${a}-${b.toLowerCase()}`
  }).toLowerCase()
}

const exec = async () => {
  await cleanModelsDir()
  await copyBaseModel()

  const data = (await fs.readFile(
    path.resolve(process.cwd(), swaggerFilePath)
  )).toString()
  const swaggerData = JSON.parse(data)

  for (const modelName in swaggerData.definitions) {
    const modelNameFixed = modelName.replace('.', '')

    const pathFile = path.resolve(pathModels, `${toKebabCase(modelNameFixed)}.model.ts`)

    const enumsOrTypes: string[] = []
    const propertiesTypes: string[] = []
    const propertiesStrings: string[] = []
    const validatesStrings: string[] = []
    const imports: string[] = [
      'import { BaseModel } from \'./base.model\';',
      'import { BaseException } from \'./base.exception\';'
    ]
    const putImports = (type: string) => {
      if (!imports.includes(type)) {
        imports.push(type)
      }
    }

    Object
      .keys(swaggerData.definitions[modelName].properties)
      .forEach((property: string) => {
        const definitions = swaggerData.definitions || {}
        const ref = definitions[modelName]?.properties[property]?.$ref
        const enumList = definitions[modelName]?.properties[property]?.enum
        const typeFromSwagger = definitions[modelName]?.properties[property]?.type
        const required = definitions[modelName]?.required?.includes(property) || false
        const exceptionMessage = `${property} é obrigatório`
        const exception = `throw new BaseException('${exceptionMessage}');`

        let type = typeFromSwagger === 'integer' ? 'number' : typeFromSwagger
        if (type === 'array' && definitions[modelName]?.properties[property]?.items?.$ref) {
          let classRefName = definitions[modelName]?.properties[property]?.items?.$ref?.replace('#/definitions/', '')
          const refNameFixed = classRefName.replace('.', '')
          const refNameKebab = toKebabCase(refNameFixed)
          classRefName = `${prefixModelsName}${refNameFixed}`
          type = `${classRefName}[]`

          putImports(`import { ${classRefName} } from './${refNameKebab}.model';`)
          propertiesTypes.push(`${property}: ${type || 'any'}`)
          propertiesStrings.push(
            `this.${property} = (payload.${property} || []).map((v) => new ${classRefName}(v));`
          )

          if (required) {
            validatesStrings.push(`
              if (this.${property} && this.${property}.length) {
                await Promise.all(
                  this.${property}.map((item) => {
                    return item.validate()
                  })
                )
              }
            `)
          }
        } else {
          if (required) {
            if (typeFromSwagger === 'string') {
              validatesStrings.push(
                `if (!this.${property}) {
                ${exception}
              }`
              )
            }

            if (typeFromSwagger === 'number') {
              validatesStrings.push(`if (typeof this.${property} !== 'number') {
              ${exception}
            }`)
            }
          }

          if (ref) {
            const refName = ref.replace('#/definitions/', '')
            const refNameFixed = refName.replace('.', '')
            const refNameKebab = toKebabCase(refNameFixed)

            putImports(`import { ${prefixModelsName + refNameFixed} } from './${refNameKebab}.model';`)
            propertiesTypes.push(`${property}: ${prefixModelsName + refNameFixed}`)
            propertiesStrings.push(`this.${property} = new ${prefixModelsName + refNameFixed}(payload.${property})`)
            validatesStrings.push(`this.${property} && await this.${property}.validate()`)
          } else if (enumList && enumList.length) {
            const enumOrTypeName = `${modelNameFixed}${property[0].toUpperCase() + property.slice(1)}Type`
            enumsOrTypes.push(`export type ${enumOrTypeName} = ${enumList.map((item: string) => `'${item}'`).join(' | ')}`)
            propertiesTypes.push(`${property}: ${enumOrTypeName}`)
            propertiesStrings.push(`this.${property} = payload.${property};`)
          } else {
            propertiesTypes.push(`${property}: ${type || 'any'}`)
            propertiesStrings.push(`this.${property} = payload.${property};`)
          }
        }
      })

    const className = prefixModelsName + modelNameFixed
    const classString = `${imports.join('\n')}

      ${enumsOrTypes.join('\n\n')}
  
      export class ${className} extends BaseModel {
        ${propertiesTypes.map((t: string) => `${t} | undefined`).join('\n')}

        constructor (payload: Partial<${className}> = {}) {
          super()
          ${propertiesStrings.join('\n')}
        }
        async validate (): Promise<void> {
          ${validatesStrings.join('\n')}
        }
      }
  `
    await fs.writeFile(pathFile, classString)
  }
}

exec()
  .then(() => {
    const handler = spawn(`eslint -c ${path.resolve(__dirname, '../.eslintrc.js')} --fix ${pathModels}/**/*.ts`, {
      shell: true,
      cwd: process.cwd(),
      stdio: 'inherit'
    })
    // error
    handler.on('error', (err) => {
      console.error(err)
      process.exit(1)
    })
  })
