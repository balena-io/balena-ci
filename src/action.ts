import * as core from '@actions/core';
import { context } from '@actions/github';

import * as versionbot from './versionbot-utils';
import * as balena from './balena-utils';
import * as git from './git';
import { createTag } from './github-utils';

export async function run(): Promise<void> {
	// If the payload does not have a repository object then fail early (the events we are interested in always have this)
	if (!context.payload.repository) {
		throw new Error('Workflow payload was missing repository object');
	}

	// Get the master branch so we can infer intent
	const target = context.payload.repository.master_branch;
	// Name of the fleet to build for
	const fleet = core.getInput('fleet', { required: true });
	// Custom location for Dockerfile/docker-compose (instead of being in root of GITHUB_WORKSPACE)
	const dockerfileLocation = core.getInput('source', { required: false });
	// File path to build release images from
	const src = `${process.env.GITHUB_WORKSPACE!}/${dockerfileLocation}`;
	// ID of release built
	let releaseId: string | null = null;
	// Version of release built
	let rawVersion: string | null = null;

	if (context.payload.action === 'closed') {
		// If a pull request was closed and merged then just finalize the release!
		if (context.payload.pull_request?.merged) {
			// Get the previous release built
			const previousRelease = await balena.getReleaseByTags(fleet, {
				sha: context.payload.pull_request?.head.sha,
				pullRequestId: context.payload.pull_request?.id,
			});
			if (!previousRelease) {
				throw new Error(
					'Action reached point of finalizing a release but did not find one',
				);
			} else if (previousRelease.isFinal) {
				core.info('Release is already finalized so skipping.');
				return;
			}
			// Finalize release and done!
			return await balena.finalize(previousRelease.id);
		} else {
			// If the pull request was closed but not merged then do nothing
			core.info('Pull request was closed but not merged, nothing to do.');
			return;
		}
	}

	// If the repository uses Versionbot then checkout Versionbot branch
	if (core.getBooleanInput('versionbot', { required: false })) {
		const versionbotBranch = await versionbot.getBranch(
			context.payload.pull_request?.number!,
		);
		// This will checkout the branch to the `GITHUB_WORKSPACE` path
		await git.checkout(versionbotBranch);
	}

	let buildOptions = null;
	// If we are pushing directly to the target branch then just build a release without draft flag
	if (context.eventName === 'push' && context.ref === `refs/heads/${target}`) {
		// Make a final release because context is master workflow
		buildOptions = {
			draft: false,
			tags: { sha: context.sha },
		};
	} else if (context.eventName !== 'pull_request') {
		// Make sure the only events now are Pull Requests
		if (context.eventName === 'push') {
			throw new Error(
				`Push workflow only works with ${target} branch. Event tried pushing to: ${context.ref}`,
			);
		}
		throw new Error(`Unsure how to proceed with event: ${context.eventName}`);
	} else {
		// Make a draft release because context is PR workflow
		buildOptions = {
			tags: {
				sha: context.payload.pull_request?.head.sha,
				pullRequestId: context.payload.pull_request?.id,
			},
		};
	}

	// Finally send source to builders
	releaseId = await balena.push(fleet, src, buildOptions);

	// Now that we built a release set the expected outputs
	rawVersion = await balena.getReleaseVersion(parseInt(releaseId, 10));
	core.setOutput('version', rawVersion);
	core.setOutput('release_id', releaseId);

	// originally called create_ref but was renamed to create_tag
	if (
		core.getBooleanInput('create_tag', { required: false }) ||
		core.getInput('create_ref', { required: false })
	) {
		try {
			await createTag(
				rawVersion,
				context.payload.pull_request?.head.sha || context.sha,
			);
		} catch (e: any) {
			if (e.message !== 'Reference already exists') {
				throw e;
			}
			core.info('Git reference already exists.');
		}
	}
}
