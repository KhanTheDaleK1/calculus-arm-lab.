/**
 * Site Footer & Modal Logic
 * Handles Credits and EULA modals across the site.
 */
document.addEventListener('DOMContentLoaded', () => {
    
    // Function to open a modal
    const openModal = (modalId) => {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.add('active');
            document.body.style.overflow = 'hidden'; // Prevent background scrolling
        }
    };

    // Function to close a modal
    const closeModal = (modal) => {
        if (modal) {
            modal.classList.remove('active');
            document.body.style.overflow = ''; // Restore scrolling
        }
    };

    // Setup triggers for Credits
    const creditTriggers = document.querySelectorAll('.btn-credits-trigger');
    creditTriggers.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            openModal('credits-modal');
        });
    });

    // Setup triggers for EULA
    const eulaTriggers = document.querySelectorAll('.btn-eula-trigger');
    eulaTriggers.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            openModal('eula-modal');
        });
    });

    // Close logic (Clicking overlay or close button)
    const overlays = document.querySelectorAll('.modal-overlay');
    overlays.forEach(overlay => {
        // Close on clicking outside content
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                closeModal(overlay);
            }
        });

        // Close button inside
        const closeBtn = overlay.querySelector('.modal-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => closeModal(overlay));
        }
    });

    // Global Escape Key to close any active modal
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            document.querySelectorAll('.modal-overlay.active').forEach(m => {
                closeModal(m);
            });
        }
    });
});