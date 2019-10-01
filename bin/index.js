#!/usr/bin/env node

'use strict'

const log = require('acho')({
  keyword: 'λ',
  types: require('acho-skin-cli')
})
const beautyError = require('beauty-error')
const { existsSync } = require('fs')
const AWS = require('aws-sdk')
const path = require('path')

const pkg = require('../package.json')

require('update-notifier')({ pkg }).notify()

const cli = require('meow')({
  pkg,
  flags: {
    cwd: {
      type: 'string',
      default: process.cwd()
    },
    justPrint: {
      type: 'boolean',
      default: false
    }
  }
})

const onExit = err => {
  if (err) console.error(beautyError(err))
  return process.exit(err ? 1 : 0)
}

const getFunctionName = cli => {
  if (cli.input.length > 0) return cli.input[0]
  const pkgJson = path.resolve(cli.flags.cwd, 'package.json')
  if (existsSync(pkgJson)) return require(pkgJson).name
  return undefined
}

const getDeployAlias = deploy => {
  if (deploy.Environment.Variables.UP_COMMIT) {
    return `commit-${deploy.Environment.Variables.UP_COMMIT}`
  }
  return undefined
}

const main = async () => {
  const functionName = getFunctionName(cli)
  if (!functionName) cli.showHelp()

  const { justPrint } = cli.flags

  const required = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_REGION']

  const missing = required.filter(key => process.env[key] === undefined)

  if (missing.length > 0) {
    onExit(
      new TypeError(
        `Missing required environment variable(s): ${missing.join(', ')}`
      )
    )
  }

  const lambda = new AWS.Lambda({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION
  })

  const { Versions: functions } = await lambda
    .listVersionsByFunction({ FunctionName: functionName })
    .promise()

  // keep the latest 3 versions
  const [, , , ...functionsByDate] = functions.sort((previous, next) => {
    if (previous.LastModified < next.LastModified) return 1
    if (previous.LastModified > next.LastModified) return -1
    return 0
  })

  let aliasCount = 0

  for (const deployedFunction of functionsByDate) {
    try {
      const opts = {
        FunctionName: functionName,
        Qualifier: deployedFunction.Version
      }

      const aliasName = getDeployAlias(deployedFunction)

      if (aliasName) {
        ++aliasCount
        log.success({ alias: aliasName })
        if (!justPrint) {
          await lambda
            .deleteAlias({ FunctionName: functionName, Name: aliasName })
            .promise()
        }
      }

      log.success({
        version: deployedFunction.Version,
        runtime: deployedFunction.Runtime,
        memory: deployedFunction.MemorySize
      })

      if (!justPrint) {
        await lambda.deleteFunction(opts).promise()
      }
    } catch (err) {
      log.error(err.message)
    }
  }

  console.log()
  log.info('done', { functions: functionsByDate.length, alias: aliasCount })
}

main()
  .then(() => {
    process.exit(0)
  })
  .catch(err => {
    console.log(beautyError(err))
    process.exit(1)
  })
