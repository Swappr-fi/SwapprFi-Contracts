// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract SwapperERC721 is ERC721Enumerable, ERC721URIStorage, Ownable {
    uint256 public nextTokenId;
    uint256 public maxSupply;

    constructor(
        string memory _name,
        string memory _symbol,
        uint256 _maxSupply
    ) ERC721(_name, _symbol) Ownable(msg.sender) {
        maxSupply = _maxSupply;
    }

    function mint(address to, string calldata uri) external onlyOwner returns (uint256) {
        require(maxSupply == 0 || nextTokenId < maxSupply, "SwapperERC721: MAX_SUPPLY");
        uint256 tokenId = nextTokenId++;
        _mint(to, tokenId);
        _setTokenURI(tokenId, uri);
        return tokenId;
    }

    function mintBatch(address to, string[] calldata uris) external onlyOwner returns (uint256[] memory) {
        uint256 count = uris.length;
        require(maxSupply == 0 || nextTokenId + count <= maxSupply, "SwapperERC721: MAX_SUPPLY");
        uint256[] memory tokenIds = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            uint256 tokenId = nextTokenId++;
            _mint(to, tokenId);
            _setTokenURI(tokenId, uris[i]);
            tokenIds[i] = tokenId;
        }
        return tokenIds;
    }

    // Required overrides for ERC721Enumerable + ERC721URIStorage
    function _update(address to, uint256 tokenId, address auth) internal override(ERC721, ERC721Enumerable) returns (address) {
        return super._update(to, tokenId, auth);
    }

    function _increaseBalance(address account, uint128 value) internal override(ERC721, ERC721Enumerable) {
        super._increaseBalance(account, value);
    }

    function tokenURI(uint256 tokenId) public view override(ERC721, ERC721URIStorage) returns (string memory) {
        return super.tokenURI(tokenId);
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721Enumerable, ERC721URIStorage) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
