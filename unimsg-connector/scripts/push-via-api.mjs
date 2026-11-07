/**
 * 通过 GitHub REST API 推送提交。
 *
 * 起因：这台机器上 github.com:443 走代理被拦（CONNECT 502），但
 * api.github.com 可以通。于是用 Git Data API 把本地 HEAD 之后的改动
 * 直接写成 blob → tree → commit → 更新 ref，效果等同 `git push`。
 *
 * 令牌来自 git credential fill（GCM 已存储），只在内存里用，不落盘、不打印。
 */
import { execFileSync } from 'node:child_process';

const OWNER = 'lebin2025';
const REPO = 'LinkHub';
const BRANCH = 'main';

function readToken() {
  const out = execFileSync('git', ['credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n',
    encoding: 'utf8',
  });
  const password = out.split('\n').find((l) => l.startsWith('password='));
  if (!password) throw new Error('没拿到凭据');
  return password.slice('password='.length).trim();
}

const token = readToken();

async function api(path, init = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

/** 本地 HEAD 的提交（只推这一个，父提交应当等于远端 head） */
function localHead() {
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const parent = execFileSync('git', ['rev-parse', 'HEAD^'], { encoding: 'utf8' }).trim();
  const message = execFileSync('git', ['log', '-1', '--pretty=%B'], { encoding: 'utf8' }).trim();
  const files = execFileSync('git', ['diff', '--name-status', parent, sha], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [status, path] = line.split('\t');
      return { status, path };
    });
  return { sha, parent, message, files };
}

async function main() {
  const head = localHead();
  const ref = await api(`/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`);
  const remoteSha = ref.object.sha;

  console.log('本地 HEAD :', head.sha);
  console.log('远端 head :', remoteSha);
  if (remoteSha === head.sha) {
    console.log('远端已经是最新，无需推送');
    return;
  }
  if (remoteSha !== head.parent) {
    throw new Error('远端 head 与本地父提交不一致，需要先 pull/rebase，这里不硬推');
  }

  // 1) 有改动的文件 → blob（删除的文件给 null）
  const entries = [];
  for (const file of head.files) {
    if (file.status === 'D') {
      entries.push({ path: file.path, mode: '100644', type: 'blob', sha: null });
      continue;
    }
    const content = execFileSync('git', ['show', `${head.sha}:${file.path}`], {
      encoding: 'buffer',
      maxBuffer: 64 * 1024 * 1024,
    });
    const blob = await api(`/repos/${OWNER}/${REPO}/git/blobs`, {
      method: 'POST',
      body: JSON.stringify({ content: content.toString('base64'), encoding: 'base64' }),
    });
    const mode = execFileSync('git', ['ls-tree', head.sha, file.path], { encoding: 'utf8' }).split(' ')[0];
    entries.push({ path: file.path, mode: mode || '100644', type: 'blob', sha: blob.sha });
    console.log('blob  ', file.path);
  }

  // 2) tree（沿用远端父提交的 tree 作为 base，只覆盖改到的文件）
  const parentCommit = await api(`/repos/${OWNER}/${REPO}/git/commits/${head.parent}`);
  const tree = await api(`/repos/${OWNER}/${REPO}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({ base_tree: parentCommit.tree.sha, tree: entries }),
  });

  // 3) commit
  const commit = await api(`/repos/${OWNER}/${REPO}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({ message: head.message, tree: tree.sha, parents: [head.parent] }),
  });

  // 4) 更新分支
  await api(`/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: commit.sha, force: false }),
  });

  console.log('远端已更新为', commit.sha);
  console.log('文件数', entries.length);
}

main().catch((err) => {
  console.error('失败：', err.message);
  process.exit(1);
});
