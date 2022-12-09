import { Octokit } from '@octokit/rest';
const client = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});
interface File {
  path: string;
  mode: '100644' | '100755' | '040000' | '160000' | '120000';
  type: 'commit' | 'tree' | 'blob';
  sha?: string | null;
  content: string;
}

async function newCommit(repoOwner: string, repoName: string, commitableFiles: any) {
  // create a new tree (i.e., snapshot of the repository's files)
  const {
    data: { sha: treeSHA },
  } = await client.git.createTree({
    owner: repoOwner,
    repo: repoName,
    tree: commitableFiles,
    message: 'Updated programatically by New Order DAO',
  });

  // create a new commit on the tree and push it to the repository
  const {
    data: { sha: commitSHA },
  } = await client.git.createCommit({
    owner: repoOwner,
    repo: repoName,
    tree: treeSHA,
    message: 'Updated programatically by New Order DAO',
  });

  // update the repository's main branch to point to the new commit
  await client.git.updateRef({
    owner: repoOwner,
    repo: repoName,
    sha: commitSHA,
    ref: 'heads/main', // the name of the branch you want to push to
  });
}

export async function publishToGithubRepo(repoOwner: string, repoName: string, files: { name: string; contents: string }[]) {
  console.log('Pushing to github repo...');

  const commits = await client.repos.listCommits({
    owner: repoOwner,
    repo: repoName,
  });

  // get latest commit hash
  const commitSHA = commits.data[0].sha;
  // map to the proper format
  const commitableFiles: File[] = files.map(({ name, contents }) => {
    return {
      path: name,
      mode: '100644',
      type: 'commit',
      content: contents,
    };
  });
  console.log('commitable files: ', commitableFiles);

  if (commits.data.length === 0) {
    newCommit(repoOwner, repoName, commitableFiles);
  }

  // equivalent to adding files in git
  const {
    data: { sha: currentTreeSHA },
  } = await client.git.createTree({
    owner: repoOwner,
    repo: repoName,
    tree: commitableFiles,
    base_tree: commitSHA,
    message: 'Updated programatically by New Order DAO',
    parents: [commitSHA],
  });

  // make the commit on the tree and push it
  const {
    data: { sha: newCommitSHA },
  } = await client.git.createCommit({
    owner: repoOwner,
    repo: repoName,
    tree: currentTreeSHA,
    message: 'Updated programatically by New Order DAO',
    parents: [commitSHA],
  });

  await client.git.updateRef({
    owner: repoOwner,
    repo: repoName,
    sha: newCommitSHA,
    ref: 'heads/main', // Whatever branch you want to push to
  });
}
