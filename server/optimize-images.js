const sharp = require('sharp');
const fs = require('fs');

const images = ['image1.png', 'image2.png', 'image3.png'];

images.forEach(image => {
    if (fs.existsSync(image)) {
        sharp(image)
            .webp({ quality: 80 })
            .toFile(image.replace('.png', '.webp'))
            .then(() => console.log(`Converted ${image} to WebP`))
            .catch(err => console.error(`Error converting ${image}:`, err));
    } else {
        console.log(`Image ${image} not found`);
    }
});
