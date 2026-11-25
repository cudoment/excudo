# Excudo

[English](README.md) | [한국어](README.ko.md) | 日本語 | [简体中文](README.zh-CN.md)

**電気は無料ではありません。だからAIにも電気代の分は働いてもらいます。**

Excudo(パッケージ名 `excudo`)は、パーソナライズしたAI環境を管理し、継続的に改善していくエンジンです。名前はラテン語で"叩いて形を整える"という意味です。Claude CodeとCodexが共に従うルール、チェック、共通スキルを備え、エージェントの仕事をその基準に合わせて整えます。このエンジンで運用するフォルダーを**パーソナルプロジェクト**と呼びます。自分の資料、判断基準、スキル、自動化がそろい、仕事、学習、創作の成果を生み出す場所です。

このページは日本語の短い入門ガイドです。すべての機能は [README.md](README.md)(英語)と [README.ko.md](README.ko.md)(韓国語)に載っています。

## 5分で始める

メモを作成し、エンジンをインストールして、次のステップを確認します。

```sh
npx -y excudo@^0.9.0 init my-memo
cd my-memo
npm install
git init
npx --no-install excudo start
```

このフォルダーをコーディングエージェントで開き、"Add 'Read one chapter' to my memo."のように依頼してください。
続けてローカルのウェブサイトを作ると、ブラウザーでメモを見られます。

```sh
npm install --save-dev cudoc-export@^1.1.0
npx --no-install excudo site --open
```

ターミナルとMarkdownエディターは好きなものを使えます。Orca、Tine、サイトのホスティングは任意です。
ローカルのサイトはホスティングのアカウントなしで開けます。
次に進むステップの一覧は、`excudo start` が自動で表示します。生成された一覧は [README.md の Get started](README.md#get-started) にあります。

## コーディングエージェントでインストールする

空の場所で開いたコーディングエージェント(Claude Code、Codex)に、次の文を貼り付けてください。

> Set up Excudo from https://github.com/cudoment/excudo in a new folder, following its README.ja.md section "コーディングエージェントでインストールする"

意味: https://github.com/cudoment/excudo の README.ja.md にある"コーディングエージェントでインストールする"の節に従って、新しいフォルダーにExcudoをセットアップしてください。

エージェントは次のルールに従います。4番のコマンドと報告の確認だけを実行し、5分で始めるのウェブサイトのブロックは実行しません。

1. Node.jsが22.16以上であることを確認します(`node --version`)。満たさない場合は中止し、https://nodejs.org を案内します。
2. 尋ねるのはフォルダー名だけで、一度だけにします。ファイルとメモの言語には `en` を使います(`--locale en`)。所有者が韓国語を読む場合に限り `ko` を使います。ファイルの言語に関係なく、所有者とは所有者の言語(日本語、またはほかの言語)で会話を続けます。
3. グローバルにはインストールしません。`npm install -g` は使わず、npm自身のキャッシュを除いて、新しいフォルダーの外は変更しません。
4. `npx -y excudo@^0.9.0 init <folder> --locale en` を実行し、続けて次の1行を実行します: `cd <folder> && npm install && git init && npx --no-install excudo start --report --json`。`init` のあとのコマンドはすべて `<folder>` の中で実行します。`init` はgitを実行しないため、`git init` も手順に含まれています。
5. 報告(`--report --json`)を読んで確認します。ステップ `workspace`、`install`、`git`、`skills` がすべて `done` なら、インストールは成功です。`done` でないステップがあれば、その `id` と `state` を示し、どうするかを所有者に尋ねます。原因を推測したり、ほかのコマンドを実行したりしません。
6. コマンドが失敗したら中止し、エラー出力の最後の数行を示して所有者に尋ねます。自分で修正したり、別のコマンドを試したりしません。
7. 最後に、残っている次のステップ、つまり `stoppedAt` が指すステップを所有者に引き渡します。その `run`、`ask`、`setting` をそのまま伝え、自分では実行しません。

## エンジンを更新する

新しいリリースがあるかを確認してから、インストールするかを決めます。

```sh
npx --no-install excudo update
npx --no-install excudo update --channel next --json
npx --no-install excudo update --apply
```

既定のチャンネルは、安定版の `latest` です。
`--channel next` はベータ版と安定版のタグを比べ、高いほうのバージョンを選びます。`--channel` を付けない場合、インストール済みのプレリリース版は `next` に、それ以外は `latest` に従います。
このコマンドは、インストール済みとレジストリのバージョン、利用できるリリースノート、実行すべきインストールコマンドを表示します。
`--apply` を付けたときだけ、ワークスペースからインストールし、そのスキルを更新します。
`--apply` のあとは `excudo start --report` と、表示されるセットアップのチェックを実行し、足りないテンプレートのルールを見つけます。

## 問題を報告する

報告をローカルで作成して内容を確認し、共有したいときにGitHubのissueリンクを開きます。

```sh
npx --no-install excudo feedback --title "Cannot build" --message "What happened and what I expected"
npx --no-install excudo feedback --out feedback.md --json
```

下書きは、あなたのメッセージを先頭に置き、バージョン、プラットフォーム、オンボーディングの状態、決まった診断IDだけを加えます。
ホーム、ワークスペース、グラフのパスなどの個人情報は伏せ字になります。
このコマンドは報告を送信せず、ブラウザーも開きません。`--out` は無害化した下書きだけを書き出します。
フォームは [バグ報告](https://github.com/cudoment/excudo/issues/new?template=bug.yml) と [使い勝手の報告](https://github.com/cudoment/excudo/issues/new?template=usability.yml) です。

## 詳しい説明

すべてのコマンド、設定、スキルの説明は [README.md](README.md)(英語)と [README.ko.md](README.ko.md)(韓国語)にあります。
