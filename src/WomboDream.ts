import axios, { AxiosInstance } from 'axios';
import { sprintf } from 'sprintf-js';
import sleep from 'sleep-promise';
import GoogleAuthentifier from './GoogleAuthentifier';
import { Task, TaskImageInputSpec, UploadResource } from './types';
import { Style } from 'util';

export const DEFAULT_DISPLAY_FREQ = 10;
export const DEFAULT_CHECK_FREQ = 1000;

export class WomboDream {
	constructor(
		public authentifier: GoogleAuthentifier,
		public apiTaskUrl: string,
		public apiStyleUrl: string,
		public originUrl: string,
		public uploadUrl: string
	) {}

	buildApiTaskUrl(taskId: string): string {
		return sprintf(this.apiTaskUrl, { taskId });
	}

	buildRawApiTaskUrl(): string {
		return this.buildApiTaskUrl('');
	}

	buildUploadUrl(): string {
		return this.uploadUrl;
	}

	buildApiStyleUrl(): string {
		return this.apiStyleUrl;
	}

	/**
	 * Create a new HTTP request agent with custom headers
	 * @example
	 * ```ts
	 * const agent = await dreamInstance.buildHttpRequestAgent();
	 * agent.get('https://app.wombo.art').then(res => console.log(res.data));
	 * ```
	 */
	async buildHttpRequestAgent(): Promise<AxiosInstance> {
		const authorisationToken =
			await this.authentifier.obtainAuthorisationToken();
		try {
			const requestAgent = axios.create({
				baseURL: this.buildRawApiTaskUrl(),
				headers: {
					Origin: this.originUrl,
					Referer: this.originUrl,
					Authorization: `Bearer ${authorisationToken}`,
					service: 'Dream',
				},
			});
			return requestAgent;
		} catch (error) {
			throw { reason: 'Failed to create request agent', error };
		}
	}

	/**
	 * Initialize new Task
	 *
	 * The Task wont start until it is configured
	 *
	 * @example
	 * ```ts
	 * dreamInstance.initTask().then(console.log);
	 * ```
	 */
	async initTask(premium: boolean = false): Promise<Task> {
		const requestAgent = await this.buildHttpRequestAgent();
		try {
			const initializedTask = await requestAgent.post(
				this.buildRawApiTaskUrl(),
				{
					premium,
				}
			);
			return initializedTask.data;
		} catch (error) {
			throw {
				reason: 'Failed to initialize task',
				error,
			};
		}
	}

	/**
	 * Configure an existing Task
	 *
	 * @param input_image use an image as input
	 * @param display_freq how often the task makes intermediate renders
	 *
	 * @example
	 * ```ts
	 * const task:Task;
	 * dreamInstance.configureTask(task, "kitten", 12).then(console.log);
	 * ```
	 */
	async configureTask(
		task: Task,
		prompt: string,
		style: number,
		input_image?: TaskImageInputSpec,
		display_freq: number = DEFAULT_DISPLAY_FREQ
	): Promise<Task> {
		const requestAgent = await this.buildHttpRequestAgent();
		try {
			const configuredTask = await requestAgent.put(
				this.buildApiTaskUrl(task.id),
				{
					input_spec: {
						display_freq,
						prompt,
						style,
						input_image,
					},
				},
				{
					headers: {
						'Access-Control-Request-Method': 'PUT',
					},
				}
			);
			return configuredTask.data;
		} catch (error) {
			throw {
				reason: 'Failed to configure task',
				error,
			};
		}
	}

	/**
	 * Create and configure an existing Task
	 *
	 * @param input_image use an image as input
	 * @param display_freq how often the task makes intermediate renders
	 *
	 * @example
	 * ```ts
	 * dreamInstance.createTask("kitten", 12).then(console.log);
	 * ```
	 */
	async createTask(
		prompt: string,
		style: number,
		input_image?: TaskImageInputSpec,
		display_freq: number = DEFAULT_DISPLAY_FREQ,
		premium: boolean = false
	): Promise<Task> {
		try {
			const initializedTask = await this.initTask(premium);

			const configuredTask = await this.configureTask(
				initializedTask,
				prompt,
				style,
				input_image,
				display_freq
			);

			return configuredTask;
		} catch (error) {
			throw {
				reason: 'Failed to create task',
				error,
			};
		}
	}

	/**
	 * Fetch the current infos of a Task
	 *
	 * @example
	 * ```ts
	 * const taskId:string;
	 * dreamInstance.fetchTaskInfos(taskId).then(console.log);
	 * ```
	 */
	async fetchTaskInfos(taskId: string): Promise<Task> {
		const requestAgent = await this.buildHttpRequestAgent();
		try {
			const task = await requestAgent.get(this.buildApiTaskUrl(taskId));
			return task.data;
		} catch (error) {
			throw { reason: 'Failed to fetch task info', error };
		}
	}

	/**
	 * Create a new task and generate a picture
	 *
	 * @param progressCallback a callback function that will be called with the progress of the Task
	 * @param input_image use an image as input
	 * @param display_freq how often the task makes intermediate renders
	 *
	 * @example
	 * ```ts
	 * dreamInstance.generatePicture('kitten', 12, (task) => {
	 *			console.log(task.state, 'stage', task.photo_url_list.length);
	 *		})
	 *		.then((task) => console.log(task?.result.final))
	 *		.catch(console.error);
	 * ```
	 */
	async generatePicture(
		prompt: string,
		style: number,
		progressCallback: (task: Task) => void = () => {},
		input_image?: TaskImageInputSpec,
		checkFrequency: number = DEFAULT_CHECK_FREQ,
		display_freq: number = DEFAULT_DISPLAY_FREQ,
		premium: boolean = false
	): Promise<Task> {
		let task = await this.createTask(
			prompt,
			style,
			input_image,
			display_freq,
			premium
		);

		try {
			while (!task.result?.final) {
				task = await this.fetchTaskInfos(task.id);
				progressCallback(task);
				await sleep(checkFrequency);
			}
			return task;
		} catch (error) {
			progressCallback({ ...task, state: 'failed' });
			throw {
				reason: 'Failed to generate picture',
				error,
			};
		}
	}

	/**
	 * Upload an image for later use
	 *
	 * @example
	 * ```ts
	 * dreamInstance.uploadImage(fs.readFileSync('./image.jpg')).then(console.log);
	 * ```
	 */
	async uploadImage(bufferedImage: Buffer): Promise<UploadResource> {
		const requestAgent = await this.buildHttpRequestAgent();

		try {
			const resourceUploadInfos: UploadResource = (
				await requestAgent.post(
					this.buildUploadUrl(),
					{
						media_expiry: 'HOURS_72',
						media_suffix: 'jpeg',
						num_uploads: 1,
					},
					{
						headers: {
							service: 'Dream',
						},
					}
				)
			).data?.shift();

			await requestAgent.put(resourceUploadInfos.media_url, bufferedImage, {
				headers: {
					'Content-Type': 'image/jpeg',
					'Content-Length': bufferedImage.length,
				},
			});

			return resourceUploadInfos;
		} catch (error) {
			throw {
				reason: 'Failed to upload image',
				error,
			};
		}
	}

	/**
	 * Fetch all available styles
	 *
	 * @example
	 * ```ts
	 * dreamInstance.fetchStyles().then(console.log);
	 * ```
	 */
	async fetchStyles(): Promise<Array<Style>> {
		const requestAgent = await this.buildHttpRequestAgent();
		try {
			const styles = await requestAgent.get(this.buildApiStyleUrl());
			return styles.data;
		} catch (error) {
			throw { reason: 'Failed to fetch styles', error };
		}
	}
}

export default WomboDream;
