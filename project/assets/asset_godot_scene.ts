import path from "path"

import { BaseAsset } from "./base_asset"
import { TsGdProjectClass } from "../project"
import { AssetSourceFile } from "./asset_source_file"
import { AssetGlb } from "./asset_glb"
import { parseGodotConfigFile } from "../godot_parser"
import { addError, ErrorName } from "../../errors"
import chalk from "chalk"

interface IGodotSceneFile {
  gd_scene: {
    $section: {
      load_steps: number
      format: number
    }
  }

  ext_resource?: {
    $section: {
      identifier: "ext_resource"
      path: string
      type: string
      id: number
    }
  }[]

  sub_resource: {
    $section: {
      identifier: "sub_resource"
      type: string
      id: number
    }
  }[]

  node?: {
    $section: {
      identifier: "node"
      name: string
      type: string
      parent?: string
      groups?: string[]
      instance?: {
        args: [number]
        identifier: string // 'ExtResource' most likely
      }
    }
    position?: {
      args: [number, number]
      identifier: string
    }
    script?: {
      args: [number]
      identifier: string
    }

    [key: string]: any
  }[]
}

export class GodotNode {
  name: string
  private _type: string
  isRoot: boolean
  groups: string[]
  parent: string | undefined
  $section: Required<IGodotSceneFile>["node"][0]["$section"]
  scene: AssetGodotScene
  project: TsGdProjectClass
  scriptExtResourceId: number | undefined

  constructor(
    props: Required<IGodotSceneFile>["node"][0],
    scene: AssetGodotScene,
    project: TsGdProjectClass
  ) {
    this.name = props.$section.name
    this.project = project
    this.scene = scene
    this._type = props.$section.type
    this.isRoot = props.$section.parent ? false : true
    this.groups = props.$section.groups ?? []
    this.$section = props.$section
    this.parent = props.$section.parent ?? undefined
    this.scriptExtResourceId = props.script?.args?.[0] ?? undefined
  }

  /**
   * e.g. "Player" for a node on the root
   * e.g. "Player/Arm" for a nested node
   * e.g. "." for the root
   */
  scenePath(): string {
    if (!this.parent) {
      return "."
    }

    if (this.parent === ".") {
      return this.name
    }

    return this.parent + "/" + this.name
  }

  children(): GodotNode[] {
    const path = this.scenePath()

    return this.scene.nodes.filter(
      (node) => node.parent === path && !node.isInstanceOverride()
    )
  }

  private instanceId(): number | undefined {
    let instanceId = this.$section.instance?.args[0]

    if (!instanceId && instanceId !== 0) {
      return undefined
    }

    return instanceId
  }

  isInstance(): boolean {
    return !!this.instanceId()
  }

  /**
   * If this node is an instance of a scene, return that scene.
   */
  instance(): AssetGodotScene | AssetGlb | undefined {
    const instanceId = this.instanceId()

    if (instanceId === undefined) {
      return undefined
    }

    const res = this.scene.resources.find((res) => res.id === instanceId)

    if (!res) {
      throw new Error(
        `Can't find associated scene for id ${instanceId} on ${this.scenePath()}`
      )
    }

    const matchingScene = this.project
      .godotScenes()
      .find((scene) => scene.fsPath === res?.fsPath)

    if (matchingScene) {
      return matchingScene
    }

    const matchingGlb = this.project
      .godotGlbs()
      .find((glb) => glb.fsPath === res?.fsPath)

    if (matchingGlb) {
      return matchingGlb
    }

    return undefined
  }

  /**
   * This will be true if this node is just the overridden properties
   * of another node.
   *
   * This can happen e.g. when you instance a scene in another scene, and then
   * move one of the instanced scene's nodes.
   */
  isInstanceOverride() {
    return !this._type && !this.isInstance()
  }

  tsType(): string {
    if (this._type) {
      return this._type
    }

    if (this.isInstanceOverride()) {
      addError({
        description: `Error: should never try to get the type of an instance override. This is a ts2gd internal bug. Please report it on GitHub.`,
        error: ErrorName.InvalidFile,
        location: this.name,
        stack: new Error().stack ?? "",
      })

      return "any"
    }

    const instancedSceneType = this.instance()?.tsType()

    if (instancedSceneType) {
      return instancedSceneType
    }

    addError({
      description: `Error: Your Godot scene ${chalk.blue(
        this.scene.fsPath
      )} refers to ${chalk.red(
        this.scenePath()
      )}, but it doesn't exist. It may have been deleted from the project. the tstype was ${
        this.scene.resPath
      }`,
      error: ErrorName.InvalidFile,
      location: this.name,
      stack: new Error().stack ?? "",
    })

    return "any"
  }

  getScript(): AssetSourceFile | undefined {
    let scriptId = this.scriptExtResourceId
    let sceneContainingScript: AssetGodotScene | undefined = this.scene

    if (!scriptId) {
      // This is made complicated because instanced scenes do not have scripts
      // stored on them as external resources in the scene in which they are instanced,
      // but act as if the script on their root node is their script.

      let instance = this.instance()

      if (instance && instance instanceof AssetGodotScene) {
        scriptId = instance.rootNode.scriptExtResourceId
        sceneContainingScript = instance
      }
    }

    if (!scriptId || !sceneContainingScript) {
      return undefined
    }

    const externalResource = sceneContainingScript.resources.find(
      (obj) => obj.id === scriptId
    )

    if (!externalResource) {
      throw new Error(
        `expected to be able to find a resource with id ${scriptId} in script ${this.scene.fsPath}, but did not.`
      )
    }

    let res = this.scene.project.assets.find(
      (sf) =>
        sf instanceof AssetSourceFile &&
        sf.resPath === externalResource?.resPath
    ) as AssetSourceFile

    return res
  }
}

type ResourceTemp = {
  resPath: string
  fsPath: string
  id: number
}

export class AssetGodotScene extends BaseAsset {
  /** e.g. /Users/johnfn/GodotProject/Scenes/my_scene.tscn */
  fsPath: string

  /** e.g. res://Scenes/my_scene.tscn */
  resPath: string

  nodes: GodotNode[]

  resources: ResourceTemp[]

  /** e.g. my_scene.tscn */
  name: string

  rootNode: GodotNode

  project: TsGdProjectClass

  constructor(fsPath: string, project: TsGdProjectClass) {
    super()

    const sceneFile = parseGodotConfigFile(fsPath, {
      ext_resource: [],
      node: [],
    }) as IGodotSceneFile

    this.fsPath = fsPath
    this.project = project
    this.resPath = TsGdProjectClass.FsPathToResPath(fsPath)

    this.resources = (sceneFile.ext_resource ?? []).map((resource) => {
      return {
        resPath: resource.$section.path,
        fsPath: TsGdProjectClass.ResPathToFsPath(resource.$section.path),
        id: resource.$section.id,
      }
    })

    this.nodes = (sceneFile.node ?? []).map(
      (node) => new GodotNode(node, this, this.project)
    )

    this.name = path.basename(fsPath, ".tscn")
    this.rootNode = this.nodes.find((node) => !node.parent)!
  }

  /** e.g. import('/Users/johnfn/GodotGame/scripts/Enemy').Enemy */
  tsType(): string {
    const rootScript = this.rootNode.getScript()

    if (rootScript) {
      const rootSourceFile = this.project
        .sourceFiles()
        .find((sf) => sf.resPath === rootScript.resPath)

      if (!rootSourceFile) {
        addError({
          description: `Failed to find root source file for ${rootScript.fsPath}`,
          error: ErrorName.Ts2GdError,
          location: rootScript.fsPath,
          stack: new Error().stack ?? "",
        })

        return "any"
      }

      const className = rootSourceFile.exportedTsClassName()

      if (!className) {
        addError({
          description: `Failed to find classname for ${rootScript.fsPath}`,
          error: ErrorName.Ts2GdError,
          location: rootScript.fsPath,
          stack: new Error().stack ?? "",
        })

        return "any"
      }

      return `import('${rootSourceFile.fsPath.slice(
        0,
        -".ts".length
      )}').${rootSourceFile.exportedTsClassName()}`
    } else {
      return this.rootNode.tsType()
    }
  }

  static extensions() {
    return [".tscn"]
  }
}
