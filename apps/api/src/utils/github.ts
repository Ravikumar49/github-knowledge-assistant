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