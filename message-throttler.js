/**
 * Message Throttler for Telegram Bot
 * Handles rate limiting to comply with Telegram API limits
 * 
 * Telegram limits:
 * - 30 messages per second for groups and channels
 * - 1 message per second per chat for private messages
 * - We use 25 messages per second to be safe
 */

class MessageThrottler {
    constructor(messagesPerSecond = 25) {
        this.queue = [];
        this.processing = false;
        this.messagesPerSecond = messagesPerSecond;
        this.intervalMs = 1000 / messagesPerSecond; // Time between messages
        this.lastSentTime = 0;
        
        console.log(`[THROTTLER] Initialized with ${messagesPerSecond} messages/sec (${this.intervalMs}ms interval)`);
    }

    /**
     * Add message to queue
     * @param {Function} messageFunction - Function that sends the message
     * @param {Object} options - Optional parameters
     * @returns {Promise} Promise that resolves when message is sent
     */
    async sendMessage(messageFunction, options = {}) {
        return new Promise((resolve, reject) => {
            const messageTask = {
                id: Date.now() + Math.random(),
                messageFunction,
                options,
                resolve,
                reject,
                timestamp: Date.now()
            };

            this.queue.push(messageTask);
            
            if (!this.processing) {
                this.processQueue();
            }
        });
    }

    /**
     * Process the message queue
     */
    async processQueue() {
        if (this.processing || this.queue.length === 0) {
            return;
        }

        this.processing = true;
        console.log(`[THROTTLER] Starting queue processing, ${this.queue.length} messages queued`);

        while (this.queue.length > 0) {
            const task = this.queue.shift();
            
            try {
                // Calculate delay needed
                const now = Date.now();
                const timeSinceLastMessage = now - this.lastSentTime;
                const delayNeeded = Math.max(0, this.intervalMs - timeSinceLastMessage);

                if (delayNeeded > 0) {
                    await new Promise(resolve => setTimeout(resolve, delayNeeded));
                }

                // Send message
                const result = await task.messageFunction();
                this.lastSentTime = Date.now();
                
                task.resolve(result);
                
                // Log progress every 10 messages
                if (this.queue.length % 10 === 0) {
                    console.log(`[THROTTLER] ${this.queue.length} messages remaining in queue`);
                }

            } catch (error) {
                console.error(`[THROTTLER] Error sending message:`, error.message);
                task.reject(error);
            }
        }

        this.processing = false;
        console.log(`[THROTTLER] Queue processing completed`);
    }

    /**
     * Get queue status
     */
    getStatus() {
        return {
            queueLength: this.queue.length,
            processing: this.processing,
            messagesPerSecond: this.messagesPerSecond,
            intervalMs: this.intervalMs
        };
    }

    /**
     * Clear the queue (emergency stop)
     */
    clearQueue() {
        const clearedCount = this.queue.length;
        this.queue.forEach(task => {
            task.reject(new Error('Queue cleared'));
        });
        this.queue = [];
        console.log(`[THROTTLER] Cleared ${clearedCount} messages from queue`);
        return clearedCount;
    }

    /**
     * Helper method for broadcast messages with progress tracking
     */
    async broadcastMessages(users, messageFunction, progressCallback = null) {
        const totalUsers = users.length;
        let successCount = 0;
        let errorCount = 0;

        console.log(`[THROTTLER] Starting broadcast to ${totalUsers} users`);

        for (let i = 0; i < users.length; i++) {
            const user = users[i];
            
            try {
                await this.sendMessage(() => messageFunction(user));
                successCount++;
            } catch (error) {
                errorCount++;
                console.error(`[THROTTLER] Failed to send to user ${user.id || user}:`, error.message);
            }

            // Call progress callback every 10 users or at the end
            if (progressCallback && (i % 10 === 0 || i === users.length - 1)) {
                const progress = {
                    current: i + 1,
                    total: totalUsers,
                    success: successCount,
                    errors: errorCount,
                    percentage: Math.round((i + 1) / totalUsers * 100)
                };
                
                try {
                    await progressCallback(progress);
                } catch (progressError) {
                    console.error('[THROTTLER] Progress callback error:', progressError.message);
                }
            }
        }

        console.log(`[THROTTLER] Broadcast completed: ${successCount}/${totalUsers} successful, ${errorCount} errors`);
        
        return {
            total: totalUsers,
            success: successCount,
            errors: errorCount
        };
    }
}

// Create global throttler instance
const throttler = new MessageThrottler(25); // 25 messages per second

module.exports = {
    MessageThrottler,
    throttler
};
