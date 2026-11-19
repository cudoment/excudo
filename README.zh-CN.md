# Excudo

[English](README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | 简体中文

**电不是免费的，所以AI也要挣回自己的电费。**

Excudo(软件包名 `excudo`)是一个引擎，用来管理个性化的AI环境并让它持续改进。名字来自拉丁语，意思是"锤打成形"。它提供Claude Code和Codex共同遵守的规则、检查和通用技能，并按这些标准把智能体的工作打磨到位。用这个引擎运行的文件夹叫作**个人项目**，里面有你的资料、判断标准、技能和自动化，工作、学习和创作的成果都在这里产生。

本页是简体中文的简短入门指南。完整内容见 [README.md](README.md)(英文)和 [README.ko.md](README.ko.md)(韩文)。

## 五分钟上手

创建备忘录，安装引擎，然后查看下一步。

```sh
npx -y excudo@^0.8.0 init my-memo
cd my-memo
npm install
git init
npx --no-install excudo start
```

用编程助手打开这个文件夹，然后提出请求，例如："Add 'Read one chapter' to my memo."
接着生成本地网站，就能在浏览器中查看备忘录。

```sh
npm install --save-dev cudoc-export@^1.1.0
npx --no-install excudo site --open
```

终端和Markdown编辑器可以随意选用。Orca、Tine和网站托管都是可选的。
本地网站不需要托管账号。
后续步骤清单由 `excudo start` 自动显示。生成的清单见 [README.md 的 Get started](README.md#get-started)。

## 用编程助手安装

在空文件夹中打开编程助手(Claude Code、Codex)，并粘贴下面这句话。

> Set up Excudo from https://github.com/cudoment/excudo in a new folder, following its README.zh-CN.md section "用编程助手安装"

含义：按照 https://github.com/cudoment/excudo 的 README.zh-CN.md 中"用编程助手安装"一节，在新文件夹里安装Excudo。

助手遵守下面的规则。它只运行第4条的命令和报告检查，不运行五分钟上手中的网站部分。

1. 确认Node.js是22.16或更高版本(`node --version`)。否则停止，并指向 https://nodejs.org。
2. 只问文件夹名称，而且只问一次。文件和备忘录的语言使用 `en`(`--locale en`);只有主人能读韩文时才用 `ko`。无论文件用什么语言，都继续用主人的语言(中文或其他语言)与主人交谈。
3. 不做全局安装：不用 `npm install -g`，除npm自身的缓存外，不改动新文件夹以外的任何内容。
4. 运行 `npx -y excudo@^0.8.0 init <folder> --locale en`，然后运行这一行：`cd <folder> && npm install && git init && npx --no-install excudo start --report --json`。`init` 之后的每条命令都在 `<folder>` 内运行。`init` 不会运行git，所以 `git init` 也是流程的一部分。
5. 读取报告(`--report --json`)来验证。当步骤 `workspace`、`install`、`git` 和 `skills` 全部是 `done` 时，安装成功。对于不是 `done` 的步骤，展示它的 `id` 和 `state`，并询问主人怎么办；不要猜测原因，也不要运行其他命令。
6. 命令失败时停止，展示错误输出的最后几行并询问主人；不要自行修复，也不要尝试其他命令。
7. 最后把剩下的下一步交给主人，也就是 `stoppedAt` 指向的那一步：原样转达它的 `run`、`ask` 和 `setting`，不要自己运行。

## 更新引擎

先检查是否有新版本，再决定是否安装。

```sh
npx --no-install excudo update
npx --no-install excudo update --channel next --json
npx --no-install excudo update --apply
```

默认通道是稳定版的 `latest`。
`--channel next` 会比较测试版和稳定版的标签，并选择较高的版本。不加 `--channel` 时，已安装的预发布版本跟随 `next`，其他版本跟随 `latest`。
命令会显示已安装版本和注册表版本、可用的发布说明以及具体的安装命令。
只有加上 `--apply` 才会安装，在你的工作区里执行，然后刷新它的技能。
`--apply` 之后，运行 `excudo start --report` 和打印出的设置检查，找出缺少的模板规则。

## 报告问题

先在本地生成报告并审阅，想分享时再打开它的GitHub issue链接。

```sh
npx --no-install excudo feedback --title "Cannot build" --message "What happened and what I expected"
npx --no-install excudo feedback --out feedback.md --json
```

草稿把你的留言放在最前面，只附上版本、平台、上手步骤状态和固定的诊断标识。
主目录、工作区和图谱的路径等个人信息会被隐去。
这个命令不会发送报告，也不会打开浏览器；`--out` 只写出已脱敏的草稿。
表单见 [缺陷报告](https://github.com/cudoment/excudo/issues/new?template=bug.yml) 和 [易用性报告](https://github.com/cudoment/excudo/issues/new?template=usability.yml)。

## 完整说明

所有命令、设置和技能的说明，见 [README.md](README.md)(英文)和 [README.ko.md](README.ko.md)(韩文)。
