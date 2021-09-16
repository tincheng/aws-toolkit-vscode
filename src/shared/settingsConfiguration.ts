/*!
 * Copyright 2018 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import * as vscode from 'vscode'
import { getLogger } from './logger'
import { ClassToInterfaceType } from './utilities/tsUtils'
import { SystemUtilities } from './systemUtilities'
import * as packageJson from '../../package.json'

/**
 * Wraps the VSCode configuration API and provides Toolkit-related
 * configuration functions.
 */
export type SettingsConfiguration = ClassToInterfaceType<DefaultSettingsConfiguration>

export type AwsDevSetting =
    | 'aws.developer.caws.apiKey'
    | 'aws.developer.caws.betaEndpoint'
    | 'aws.developer.mde.betaEndpoint'

export class DefaultSettingsConfiguration implements SettingsConfiguration {
    public constructor(private readonly extensionSettingsPrefix: string = 'aws') {}
    public readSetting<T>(settingKey: string): T | undefined
    public readSetting<T>(settingKey: string, defaultValue: T): T

    /**
     * Reads a vscode setting.
     */
    public readSetting<T>(settingKey: string, defaultValue?: T): T | undefined {
        const settings = vscode.workspace.getConfiguration(this.extensionSettingsPrefix)

        if (!settings) {
            return defaultValue
        }

        const val = settings.get<T>(settingKey)
        return val ?? defaultValue
    }

    /**
     * Sets a config value.
     *
     * Writing to the (VSCode) config store may fail if the user does not have
     * write permissions, or if some requirement is not met.  For example, the
     * `vscode.ConfigurationTarget.Workspace` scope requires a workspace.
     *
     * @param settingKey  Config key name
     * @param value  Config value
     * @param target  Config _scope_
     *
     * @returns true on success, else false
     */
    public async writeSetting<T>(settingKey: string, value: T, target: vscode.ConfigurationTarget): Promise<boolean> {
        try {
            const settings = vscode.workspace.getConfiguration(this.extensionSettingsPrefix)
            await settings.update(settingKey, value, target)
            return true
        } catch (e) {
            getLogger().error('failed to set config: %O=%O, error: %O', settingKey, value, e)
            return false
        }
    }
    /**
     * Sets a prompt message as suppressed.
     * @param promptName Name of prompt to suppress
     */
    public async disablePrompt(promptName: string): Promise<void> {
        this.validatePromptSetting(promptName)

        const setting = await this.getSuppressPromptSetting(promptName)
        if (setting === undefined || setting[promptName]) {
            return
        }
        setting[promptName] = true
        await this.writeSetting('suppressPrompts', setting, vscode.ConfigurationTarget.Global)
    }

    /**
     * Returns true if a prompt is enabled, else false.
     * @param promptName Prompt id
     * @returns False when prompt has been suppressed
     */
    public async isPromptEnabled(promptName: string): Promise<boolean> {
        this.validatePromptSetting(promptName)

        const promptSetting = await this.getSuppressPromptSetting(promptName)
        if (promptSetting !== undefined && promptSetting[promptName]) {
            return false
        }
        return true
    }

    /**
     * Gets an 'aws.suppressPrompts' for prompt `promptName`. Resets to a
     * default value if the user setting has an invalid type.
     *
     * @param promptName
     * @returns settings object
     */
    public async getSuppressPromptSetting(promptName: string): Promise<{ [prompt: string]: boolean } | undefined> {
        this.validatePromptSetting(promptName)

        try {
            const setting = this.readSetting<{ [prompt: string]: boolean }>('suppressPrompts')
            if (setting === undefined) {
                return undefined
            }

            if (typeof setting !== 'object') {
                getLogger().warn('Setting "aws.suppressPrompts" has an unexpected type. Resetting to default.')
                // writing this setting to an empty object reverts the setting to its default
                await this.writeSetting('suppressPrompts', {}, vscode.ConfigurationTarget.Global)
                return undefined
            }

            if (!(promptName in setting)) {
                getLogger().error(`Prompt not found in "aws.suppressPrompts": ${promptName}`)
                return undefined
            }

            if (typeof setting[promptName] !== 'boolean') {
                getLogger().warn(
                    `Value for prompts in "aws.suppressPrompts" must be type boolean. Resetting prompt: ${promptName}`
                )
                setting[promptName] = false
                await this.writeSetting('suppressPrompts', setting, vscode.ConfigurationTarget.Global)
                return setting
            }

            return setting
        } catch (e) {
            getLogger().error('Failed to get the setting: suppressPrompts', e)
        }
    }

    public readDevSetting<T>(key: AwsDevSetting): string
    public readDevSetting<T>(key: AwsDevSetting, type: string, silent: boolean): T | undefined

    /**
     * Gets the value of a developer only setting.
     *
     * TODO: show a dialog if this is used, and/or make a UI change (such as
     * changing the AWS Explorer color) so that it's obvious that Toolkit is in
     * "Developer mode". Throw an error in CI.
     */
    public readDevSetting<T>(key: AwsDevSetting, type: string = 'string', silent: boolean = false): T | undefined {
        const config = vscode.workspace.getConfiguration()
        const val = config.get<T>(key)
        if (!val) {
            const msg = `settings: readDevSetting(): setting "${key}": not found`
            if (!silent && !SystemUtilities.isCI()) {
                throw Error(`AWS Toolkit: ${msg}`)
            }
            getLogger().error(msg)
            return undefined
        }

        const actualType = typeof val
        if (actualType !== type) {
            const msg = `settings: readDevSetting(): setting "${key}": got ${actualType}, expected ${type}`
            if (!silent) {
                throw Error(`AWS Toolkit: ${msg}`)
            }
            getLogger().error(msg)
            return undefined
        }
        return val
    }

    /**
     * Throws an error if `name` is not a valid 'aws.suppressPrompts' setting.
     */
    private validatePromptSetting(name: string): void {
        const m = packageJson.contributes.configuration.properties['aws.suppressPrompts'].properties
        if (!(m as any)[name]) {
            throw Error(`config: unknown aws.suppressPrompts item: "${name}"`)
        }
    }
}
