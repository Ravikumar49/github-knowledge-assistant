import { Octokit } from "@octokit/rest";

// Initialize the GitHub client with your token
export const github = new Octokit({
  auth: process.env.GITHUB_ACCESS_TOKEN,
});

/*
Fetches the most recent commits for the given repository
*/

export async function getRecentCommits(owner: string, repo: string, limit: number=5) {
  try {
    const response = await github.repos.listCommits({
      owner,
      repo,
      per_page: limit,
    });

    // Map the raw response to a cleaner object for our AI agents
    return response.data.map(commit => ({
      sha: commit.sha,
      message: commit.commit.message,
      author: commit.commit.author?.name,
      date: commit.commit.author?.date,
      url: commit.html_url
    }));
  } catch(error) {
    console.error(`Error fetching commits for ${owner}/${repo}:`, error);
    throw error;
  }
}

export async function getRepositoryTree(owner: string, repo: string) {
  const { data } = await github.rest.git.getTree({
    owner,
    repo,
    tree_sha: 'HEAD',
    recursive: '1',  // Fetch the entire tree recursively
  });

  // Filter out directories and return only files
  const validFiles = (data.tree || []).filter((item: any) => {
    // We only want files contents ('blob'), not directories
    if(item.type !== 'blob' || !item.path) return false;

    const ignoreList = [
      'node_modules', 'dist/', 'build/',
      '.png', '.jpg', '.ico', '.svg', '.mp4',
      'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', '.map'
    ];

    return !ignoreList.some(ignoreItem => item.path?.includes(ignoreItem));
  });

  // Return a clean array of the relevant file paths
  return validFiles.map((file: any) => ({ 
    path: file.path, sha: file.sha
  }));
}